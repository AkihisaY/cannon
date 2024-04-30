import { CannonSigner, OnChainRegistry, PackageReference } from '@usecannon/builder';
import * as viem from 'viem';
import { DEFAULT_REGISTRY_ADDRESS } from '../constants';
import { getChainById } from '../chains';

/**
 * Checks if a package is registered on a registry provider.
 *
 * @param {Object[]} registryProviders - An array of objects containing viem.PublicClient and array of CannonSigner.
 * @param {string} packageRef - The reference string of the package to check.
 * @param {viem.Address} contractAddress - Target registry address
 * @returns {Promise<boolean[]>} - A promise that resolves to an array of booleans, each indicating if the package is registered in the corresponding registry.
 */
export const isPackageRegistered = async (
  registryProviders: { provider: viem.PublicClient; signers: CannonSigner[] }[],
  packageRef: string,
  contractAddress: viem.Address
) => {
  const packageName = new PackageReference(packageRef).name;

  const onChainRegistries = registryProviders.map(({ provider, signers }) => {
    return new OnChainRegistry({
      signer: signers[0],
      provider,
      address: contractAddress,
    });
  });

  const packageOwners = await Promise.all(
    onChainRegistries.map((onChainRegistry) => onChainRegistry.getPackageOwner(packageName))
  );

  return !packageOwners.some((address) => viem.isAddressEqual(address, viem.zeroAddress));
};

/**
 * Waits until for a specific event on the OP/OP-Sepolia Cannon Registry or a timeout occurs.
 *
 * @param {string} params.eventName - The name of the event to wait for.
 * @param {viem.Abi} params.abi - The ABI (Application Binary Interface) that includes the event.
 * @returns {Promise<void>} - A promise that resolves with the event logs when the event is received or rejects with an error on timeout or if an error occurs while watching the event.
 */

export const waitForEvent = ({ eventName, abi, chainId }: { eventName: string; abi: viem.Abi; chainId: number }) => {
  const event = viem.getAbiItem({ abi, name: eventName }) as viem.AbiEvent;

  const chain = getChainById(chainId);
  const client = viem.createPublicClient({
    chain,
    transport: viem.http(),
  });

  let timeoutId: ReturnType<typeof setTimeout>;

  return new Promise((resolve, reject) => {
    const onTimeout = () => reject(new Error(`Timed out waiting for ${eventName} event`));

    // Start watching for the event
    const unwatch = client.watchEvent({
      address: DEFAULT_REGISTRY_ADDRESS,
      event,
      onLogs: async (logs) => {
        // TODO: check event arguments
        // unwatch the event
        unwatch();
        // Clear the timeout
        clearTimeout(timeoutId);
        // Resolve the promise
        resolve(logs);
      },
      onError: (err) => {
        // unwatch the event
        unwatch();
        // Clear the timeout
        clearTimeout(timeoutId);
        // Reject the promise
        reject(new Error(`Error watching for ${eventName} event: ${err}`));
      },
    });

    // Set the timeout and store its id for cancellation
    // Docs say that the timeout should be max 3 minutes, but we add 2 extra minutes to be safe
    // Ref: https://docs.optimism.io/builders/app-developers/bridging/messaging#for-l1-to-l2-transactions
    const waitTime = 180000 + 120000; // 3 + 2 = 5 minutes
    timeoutId = setTimeout(onTimeout, waitTime);
  });
};