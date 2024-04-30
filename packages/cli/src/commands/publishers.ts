import { OnChainRegistry, PackageReference } from '@usecannon/builder';
import { blueBright, gray, green } from 'chalk';
import _ from 'lodash';
import prompts from 'prompts';
import * as viem from 'viem';
import { DEFAULT_REGISTRY_CONFIG } from '../constants';
import { checkAndNormalizePrivateKey, isPrivateKey, normalizePrivateKey } from '../helpers';
import { CliSettings } from '../settings';
import { resolveRegistryProviders } from '../util/provider';
import { waitForEvent } from '../util/register';

interface Params {
  cliSettings: CliSettings;
  options: any;
  packageRef: string;
  skipConfirm?: boolean;
}

export async function publishers({ cliSettings, options, packageRef }: Params) {
  const publisherToAdd = options.add;
  const publishersToRemove = options.remove;

  // throw an error if the user has not provided any address
  if (!publisherToAdd && !publishersToRemove) {
    throw new Error('Please provide either --add or --remove option');
  }

  // throw an error if the user has provided invalid address
  if (publisherToAdd && !viem.isAddress(publisherToAdd)) {
    throw new Error('Invalid address provided for --add option');
  }
  if (publishersToRemove && !viem.isAddress(publishersToRemove)) {
    throw new Error('Invalid address provided for --remove option');
  }

  // check if both options provided and addresses are the same
  if (publisherToAdd && publishersToRemove && viem.isAddressEqual(publisherToAdd, publishersToRemove)) {
    throw new Error('Cannot add and remove the same address in one operation');
  }

  if (!cliSettings.privateKey) {
    const keyPrompt = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter the private key of the package owner',
      style: 'password',
      validate: (key) => isPrivateKey(normalizePrivateKey(key)) || 'Private key is not valid',
    });

    if (!keyPrompt.value) {
      throw new Error('A valid private key is required.');
    }

    cliSettings.privateKey = checkAndNormalizePrivateKey(keyPrompt.value);
  }

  const isDefaultSettings = _.isEqual(cliSettings.registries, DEFAULT_REGISTRY_CONFIG);
  if (!isDefaultSettings) throw new Error('Only default registries are supported for now');

  const keyPrompt = await prompts({
    type: 'select',
    name: 'value',
    message: 'Where do you want to add or remove publishers?',
    choices: [
      { title: 'Optimism', value: 'OP' },
      { title: 'Ethereum Mainnet', value: 'ETH' },
    ],
    initial: 0,
  });

  const isMainnet = keyPrompt.value === 'ETH';
  const [mainnetRegistryConfig, optimismRegistryConfig] = cliSettings.registries;
  const [mainnetRegistryProvider, optimismRegistryProvider] = await resolveRegistryProviders(cliSettings);

  const overrides: any = {};
  if (options.maxFeePerGas) {
    overrides.maxFeePerGas = viem.parseGwei(options.maxFeePerGas);
  }

  if (options.gasLimit) {
    overrides.gasLimit = options.gasLimit;
  }

  if (options.value) {
    overrides.value = options.value;
  }

  const mainnetRegistry = new OnChainRegistry({
    signer: mainnetRegistryProvider.signers[0],
    provider: mainnetRegistryProvider.provider,
    address: mainnetRegistryConfig.address,
    overrides,
  });

  const optimismRegistry = new OnChainRegistry({
    signer: optimismRegistryProvider.signers[0],
    provider: optimismRegistryProvider.provider,
    address: optimismRegistryConfig.address,
    overrides,
  });

  const userAddress = mainnetRegistryProvider.signers[0].address;
  const packageName = new PackageReference(packageRef).name;
  const packageOwner = await mainnetRegistry.getPackageOwner(packageName);

  // throw an error if the package is not registered
  if (viem.isAddressEqual(packageOwner, viem.zeroAddress)) {
    throw new Error('The package is not registered already.');
  }
  // throw an error if the package is not registered by the user address
  if (!viem.isAddressEqual(packageOwner, userAddress)) {
    throw new Error(`Unauthorized: The package "${packageName}" is already registered by "${packageOwner}".`);
  }

  const [mainnetCurrentPublishers, optimismCurrentPublishers] = await Promise.all([
    mainnetRegistry.getAdditionalPublishers(packageName),
    optimismRegistry.getAdditionalPublishers(packageName),
  ]);

  const currentPublishers = isMainnet ? mainnetCurrentPublishers : optimismCurrentPublishers;

  // copy the current publishers
  let publishers = [...currentPublishers];

  // remove publisher if specified
  if (publishersToRemove && currentPublishers.some((p) => viem.isAddressEqual(p, publishersToRemove))) {
    publishers = publishers.filter((p) => !viem.isAddressEqual(p, publishersToRemove));
  }

  // add new publisher if specified
  if (publisherToAdd && !currentPublishers.some((p) => viem.isAddressEqual(p, publisherToAdd))) {
    publishers.push(publisherToAdd);
  }

  // throw an error if the publishers list is already up to date
  if (_.isEqual(currentPublishers, publishers)) {
    throw new Error('The publishers list is already up to date.');
  }

  console.log();
  console.log('The publishers list will be updated as follows:');
  publishers.forEach((publisher) => console.log(` - ${publisher} (${isMainnet ? 'Ethereum Mainnet' : 'OP Mainnet'})`));
  (!isMainnet ? mainnetCurrentPublishers : optimismCurrentPublishers).forEach((publisher) =>
    console.log(` - ${publisher} (${!isMainnet ? 'Ethereum Mainnet' : 'OP Mainnet'})`)
  );
  console.log();

  const verification = await prompts({
    type: 'confirm',
    name: 'confirmation',
    message: 'Proceed?',
    initial: true,
  });

  if (!verification.confirmation) {
    console.log('Cancelled');
    process.exit(1);
  }

  const [hash] = await Promise.all([
    (async () => {
      const mainnetPublishers = isMainnet ? publishers : mainnetCurrentPublishers;
      const optimismPublishers = isMainnet ? optimismCurrentPublishers : publishers;
      const hash = await mainnetRegistry.setAdditionalPublishers(packageName, mainnetPublishers, optimismPublishers);

      console.log(`${green('Success!')} (${blueBright('Transaction Hash')}: ${hash})`);
      console.log('');
      console.log(
        gray('Waiting for the transaction to propagate to Optimism Mainnet... It may take approximately 1-3 minutes.')
      );
      console.log('');

      return hash;
    })(),
    (async () => {
      // this should always resolve after the first promise but we want to make sure it runs at the same time
      await waitForEvent({
        eventName: 'PackagePublishersChanged',
        abi: optimismRegistry.contract.abi,
        chainId: optimismRegistryConfig.chainId!,
      });

      console.log(green('Success!'));
      console.log('');
    })(),
  ]);

  return hash;
}