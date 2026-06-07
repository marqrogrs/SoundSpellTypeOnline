const INVALID_RTDB_KEY_CHARS = /[.#$\[\]\/]/g;

function toStudentRecordKey(username) {
  return String(username || "")
    .trim()
    .replace(
      INVALID_RTDB_KEY_CHARS,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

module.exports = {
  toStudentRecordKey,
};
