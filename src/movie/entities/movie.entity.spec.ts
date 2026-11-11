import { getMetadataArgsStorage } from 'typeorm';
import { Movie } from './movie.entity';

describe('Movie entity', () => {
  const indicesOf = () =>
    getMetadataArgsStorage().indices.filter((index) => index.target === Movie);

  // Backs the duplicate lookup in MovieService.create.
  it('should declare a non-unique index on title and releaseDate', () => {
    const indices = indicesOf();

    expect(indices).toHaveLength(1);
    const [index] = indices;
    expect(index.columns).toEqual(['title', 'releaseDate']);
    expect(index.unique).toBeFalsy();
    // synchronize: false would mean TypeORM never creates it.
    expect(index.synchronize).toBe(true);
  });
});
