export const alphabets = {
  lower:"abcdefghijklmnopqrstuvwxyz", upper:"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits:"0123456789", symbols:"!@#$%&*+-=?_()[]{}"
};
function indexBelow(size) {
  const limit = 256 - (256 % size);
  const byte = new Uint8Array(1);
  do { crypto.getRandomValues(byte); } while (byte[0] >= limit);
  return byte[0] % size;
}
export function generatePassword(length, groups) {
  const sets = groups.map(group => alphabets[group]);
  if (!Number.isInteger(length) || length < 8 || length > 64 || !sets.length || sets.some(set => !set)) {
    throw Error("Выберите длину от 8 до 64 и хотя бы один набор символов.");
  }
  const pool = sets.join("");
  const result = sets.map(set => set[indexBelow(set.length)]);
  while (result.length < length) result.push(pool[indexBelow(pool.length)]);
  for (let i = result.length - 1; i > 0; i--) {
    const j = indexBelow(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join("");
}
