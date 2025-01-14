import { Input } from '@chakra-ui/react';
import { FC, useEffect, useState } from 'react';
import { parseEther } from 'viem';

export const NumberInput: FC<{
  handleUpdate: (value: bigint | undefined) => void;
  initialValue?: bigint;
}> = ({ handleUpdate, initialValue }) => {
  // TODO: Doesn't look a solid approach (parseEther if it has dot)
  const parseValue = (val = ''): bigint | undefined => {
    if (!val) return;
    return val.includes('.') ? parseEther(val) : BigInt(val);
  };

  const [currentValue, setUpdateValue] = useState<bigint | undefined>(
    initialValue
  );

  useEffect(() => {
    handleUpdate(currentValue || BigInt(0));
  }, [currentValue]);

  return (
    <Input
      type="number"
      bg="black"
      step="1"
      size="sm"
      placeholder="0"
      value={currentValue?.toString() || ''}
      borderColor={'whiteAlpha.400'}
      _focus={{
        borderColor: 'blue.300',
      }}
      onChange={(e) => {
        setUpdateValue(parseValue(e.target.value));
      }}
    />
  );
};
