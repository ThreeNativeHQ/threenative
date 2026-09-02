import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "storage", "local_storage.cpp"),
  "utf8",
);

function functionBody(text, signature) {
  const signatureStart = text.indexOf(signature);
  assert.ok(signatureStart >= 0, `missing ${signature}`);
  const open = text.indexOf("{", signatureStart);
  assert.ok(open > signatureStart, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return text.slice(open + 1, index);
  }
  assert.fail(`unterminated body for ${signature}`);
}

function assertPosixTempFileSync(text) {
  assert.match(text, /#include\s*<fcntl\.h>/u, "POSIX flush needs open() declarations");
  const flush = functionBody(text, "bool LocalStorage::flush()");
  const posix = flush.match(/#else([\s\S]*?)#endif/u)?.[1];
  assert.ok(posix, "flush must retain a POSIX branch alongside Windows write-through");

  assert.match(posix, /::open\([\s\S]*?tmpPath\.c_str\(\)[\s\S]*?O_WRONLY/u,
               "POSIX flush must reopen the temporary file for synchronization");
  assert.match(posix, /::fsync\s*\(\s*syncFd\s*\)/u,
               "POSIX flush must synchronize the temporary file");
  assert.match(posix, /::close\s*\(\s*syncFd\s*\)/u,
               "POSIX flush must close the synchronization descriptor");

  const openIndex = posix.search(/::open\s*\(/u);
  const syncIndex = posix.search(/::fsync\s*\(/u);
  const closeIndex = posix.search(/::close\s*\(/u);
  const renameIndex = posix.search(/std::filesystem::rename\s*\(/u);
  assert.ok(openIndex < syncIndex && syncIndex < closeIndex && closeIndex < renameIndex,
            "temp-file sync and cleanup must finish before rename");
  assert.match(posix, /if\s*\(\s*syncFd\s*[<>=!]+[\s\S]*?\)[\s\S]*?return false;/u,
               "open/fsync/close failures must fail closed");

  assert.match(posix, /const\s+std::filesystem::path\s+parentPath\s*=\s*std::filesystem::path\(filePath_\)\.parent_path\(\)/u,
               "POSIX flush must identify the containing directory");
  assert.match(posix, /::open\(\s*directoryPath\.c_str\(\)\s*,\s*O_RDONLY\s*\)/u,
               "POSIX flush must open the containing directory after rename");
  assert.match(posix, /::fsync\s*\(\s*directoryFd\s*\)/u,
               "POSIX flush must synchronize the containing directory");
  assert.match(posix, /::close\s*\(\s*directoryFd\s*\)/u,
               "POSIX flush must close the containing directory descriptor");

  const directoryOpenIndex = posix.search(/::open\s*\(\s*directoryPath\.c_str\(\)/u);
  const directorySyncIndex = posix.search(/::fsync\s*\(\s*directoryFd\s*\)/u);
  const directoryCloseIndex = posix.search(/::close\s*\(\s*directoryFd\s*\)/u);
  assert.ok(renameIndex < directoryOpenIndex &&
            directoryOpenIndex < directorySyncIndex &&
            directorySyncIndex < directoryCloseIndex,
            "directory sync and cleanup must happen after rename and before success");
  assert.match(text, /directorySyncResult\s*!=\s*0[\s\S]*?return false;/u,
               "directory sync failures must fail closed");
  assert.match(text, /directoryCloseResult\s*!=\s*0[\s\S]*?return false;/u,
               "directory close failures must fail closed");
  assert.match(text, /MOVEFILE_REPLACE_EXISTING\s*\|\s*MOVEFILE_WRITE_THROUGH/u,
               "Windows must retain write-through replacement");
}

test("POSIX localStorage flush synchronizes the temp file and containing directory", () => {
  assertPosixTempFileSync(source);

  const withoutSync = source.replace(
    /::fsync\s*\(\s*syncFd\s*\)\s*;/u,
    "/* removed by the durability negative control */",
  );
  assert.notEqual(withoutSync, source, "negative control must remove the POSIX sync call");
  assert.throws(
    () => assertPosixTempFileSync(withoutSync),
    /synchronize the temporary file/u,
    "the contract must fail when POSIX fsync is removed",
  );
});
