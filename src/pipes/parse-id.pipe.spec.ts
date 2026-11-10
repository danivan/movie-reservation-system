import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';

describe('ParseIdPipe', () => {
  const metadata = { type: 'param', data: 'id' } as ArgumentMetadata;
  const RANGE_MESSAGE =
    'Validation failed (id must be between 1 and 2147483647)';
  const NUMERIC_MESSAGE = 'Validation failed (numeric string is expected)';

  let pipe: ParseIdPipe;

  beforeEach(() => {
    pipe = new ParseIdPipe();
  });

  describe('transform', () => {
    it('should resolve the lowest valid id 1', async () => {
      await expect(pipe.transform('1', metadata)).resolves.toBe(1);
    });

    it('should resolve the Postgres integer max 2147483647', async () => {
      await expect(pipe.transform('2147483647', metadata)).resolves.toBe(
        2147483647,
      );
    });

    it.each(['0', '-1', '2147483648', '99999999999999999999999'])(
      'should reject the out-of-range id %p with BadRequestException',
      async (value) => {
        const result = pipe.transform(value, metadata);

        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({ message: RANGE_MESSAGE });
      },
    );

    it.each(['abc', '1.5', '', ' 1'])(
      'should reject the non-numeric id %p with BadRequestException',
      async (value) => {
        const result = pipe.transform(value, metadata);

        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({
          message: NUMERIC_MESSAGE,
        });
      },
    );

    it.each(['0x10', '1e3', '+5', ' 7 ', '0b11'])(
      'should reject non-decimal formats such as %p with BadRequestException',
      async (value) => {
        const result = pipe.transform(value, metadata);

        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({
          message: NUMERIC_MESSAGE,
        });
      },
    );
  });
});
