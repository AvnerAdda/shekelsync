const path = require('path');
const os = require('os');

const fakeUserData =
  process.env.ELECTRON_USER_DATA_PATH ||
  path.join(process.cwd(), 'dist', 'user-data');

const app = {
  getPath(name) {
    if (name === 'userData') {
      return fakeUserData;
    }
    if (name === 'temp') {
      return os.tmpdir();
    }
    return process.cwd();
  },
  getName() {
    return 'ShekelSync';
  },
};

const shell = {
  openExternal: () => {},
};

module.exports = {
  app,
  shell,
};
