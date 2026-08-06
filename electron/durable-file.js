const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function temporaryPathFor(filePath) {
  return `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}

function isUnsupportedDirectorySync(error) {
  return (
    process.platform === 'win32'
    && ['EACCES', 'EISDIR', 'EPERM'].includes(error?.code)
  );
}

function atomicWriteFileSync(filePath, contents, { encoding = 'utf8', mode = 0o600 } = {}) {
  const directory = path.dirname(filePath);
  const temporaryPath = temporaryPathFor(filePath);
  let fileDescriptor;
  let directoryDescriptor;
  let installed = false;

  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', mode);
    fs.writeFileSync(fileDescriptor, contents, { encoding });
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;

    fs.renameSync(temporaryPath, filePath);
    installed = true;

    try {
      directoryDescriptor = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryDescriptor);
    } catch (error) {
      if (!isUnsupportedDirectorySync(error)) {
        throw error;
      }
    } finally {
      if (directoryDescriptor !== undefined) {
        fs.closeSync(directoryDescriptor);
        directoryDescriptor = undefined;
      }
    }
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {
        // Preserve the original durable-write failure.
      }
    }

    if (!installed) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.warn('[DurableFile] Failed to clean up temporary file:', error.message);
        }
      }
    }
  }
}

async function atomicWriteFile(filePath, contents, { encoding = 'utf8', mode = 0o600 } = {}) {
  const directory = path.dirname(filePath);
  const temporaryPath = temporaryPathFor(filePath);
  let fileHandle;
  let directoryHandle;
  let installed = false;

  try {
    fileHandle = await fs.promises.open(temporaryPath, 'wx', mode);
    await fileHandle.writeFile(contents, { encoding });
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;

    await fs.promises.rename(temporaryPath, filePath);
    installed = true;

    try {
      directoryHandle = await fs.promises.open(directory, 'r');
      await directoryHandle.sync();
    } catch (error) {
      if (!isUnsupportedDirectorySync(error)) {
        throw error;
      }
    } finally {
      if (directoryHandle) {
        await directoryHandle.close();
        directoryHandle = null;
      }
    }
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Preserve the original durable-write failure.
      }
    }

    if (!installed) {
      try {
        await fs.promises.unlink(temporaryPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.warn('[DurableFile] Failed to clean up temporary file:', error.message);
        }
      }
    }
  }
}

module.exports = {
  atomicWriteFile,
  atomicWriteFileSync,
};
