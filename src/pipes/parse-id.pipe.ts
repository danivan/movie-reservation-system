import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ParseIntPipe,
  PipeTransform,
} from '@nestjs/common';

// Postgres `integer` max, the column type of `user.id`.
const MAX_PG_INTEGER = 2147483647;

@Injectable()
export class ParseIdPipe implements PipeTransform<string, Promise<number>> {
  private readonly intPipe = new ParseIntPipe();

  async transform(value: string, metadata: ArgumentMetadata): Promise<number> {
    const id = await this.intPipe.transform(value, metadata);
    // ParseIntPipe is typed nullable for its `optional` mode, which isn't used here.
    if (typeof id !== 'number' || id < 1 || id > MAX_PG_INTEGER) {
      throw new BadRequestException(
        `Validation failed (id must be between 1 and ${MAX_PG_INTEGER})`,
      );
    }
    return id;
  }
}
