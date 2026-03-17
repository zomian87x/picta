console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
const e = require('electron');
console.log('typeof electron:', typeof e);
if (typeof e === 'object' && e.app) {
  e.app.whenReady().then(() => { console.log('Ready!'); e.app.quit(); });
} else {
  console.log('electron is:', e);
  process.exit(1);
}
