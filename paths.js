const path = require('path');

const ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;

module.exports = {
  dataDir: path.join(ROOT, 'data'),
  uploadsDir: path.join(ROOT, 'uploads'),
};
