const metadataPragmas = new Set([
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'foreign_key_check', 'integrity_check', 'quick_check',
]);
const valuePragmas = new Set([
  'query_only', 'read_uncommitted', 'foreign_keys', 'database_list', 'compile_options',
  'collation_list', 'function_list', 'module_list', 'pragma_list', 'data_version',
  'schema_version', 'user_version', 'page_count', 'freelist_count',
]);

/** Gate compilation: SQLite setting PRAGMAs can execute even under EXPLAIN. */
export function assertReadSnapshotSql(sql: string): void {
  if (sql.includes('\0')) throw new Error('read_snapshot_write_forbidden');
  // Tokenize comments/quoted values so delimiters inside a literal are harmless.
  // This is a supported-read gate, not a parser for arbitrary SQL statements.
  const tokens = (sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_]\w*|\S/g) ?? [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'));
  if (tokens.some((token, index) => token === ';' && index !== tokens.length - 1)) {
    throw new Error('read_snapshot_write_forbidden');
  }
  if (tokens.at(-1) === ';') tokens.pop();
  if (tokens[0]?.toUpperCase() === 'EXPLAIN') {
    tokens.shift();
    if (tokens[0]?.toUpperCase() === 'QUERY' && tokens[1]?.toUpperCase() === 'PLAN') tokens.splice(0, 2);
  }
  const command = tokens[0]?.toUpperCase();
  if (command === 'SELECT' || command === 'WITH') return;
  if (command === 'PRAGMA') {
    const nameIndex = tokens[2] === '.' ? 3 : 1;
    const name = tokens[nameIndex]?.replace(/^['"`\[]|['"`\]]$/g, '').toLowerCase();
    const tail = tokens.slice(nameIndex + 1);
    const argument = (tail.length === 3 && tail[0] === '(' && tail[2] === ')')
      || (tail.length === 2 && tail[0] === '=');
    if (name && ((valuePragmas.has(name) && tail.length === 0)
      || (metadataPragmas.has(name) && (tail.length === 0 || argument)))) return;
  }
  throw new Error('read_snapshot_write_forbidden');
}
