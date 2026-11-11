import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Genre } from 'src/types';

@Entity()
// Non-unique: backs the duplicate check in MovieService.create.
@Index(['title', 'releaseDate'])
export class Movie {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int' })
  durationMinutes: number;

  @Column({ type: 'enum', enum: Genre })
  genre: Genre;

  @Column({ type: 'date' })
  releaseDate: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  posterUrl: string | null;
}
