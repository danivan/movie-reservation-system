export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Postgres text rejects U+0000, and native bcrypt hashes an all-NUL
// password the same as an empty one (G21).
export const NO_NUL = /^[^\u0000]*$/;
export const NO_NUL_OPTIONS = {
  message: '$property must not contain NUL characters',
};
