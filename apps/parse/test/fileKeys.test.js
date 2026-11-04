// node test/fileKeys.test.js
const { saltFileName, keyForFileName, saltUploadUrl } = require('../src/fileKeys');

let failed = 0;
const check = (label, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

const SALT = '[0-9a-f]{16}_';

check('a parseUser= name is salted after fileName=',
  new RegExp(`^parseUser=u1_fileName=${SALT}1_x\\.png$`).test(saltFileName('parseUser=u1_fileName=1_x.png')));
check('so is the legacy form, after the id',
  new RegExp(`^parseuser=u1_${SALT}x\\.png$`).test(saltFileName('parseuser=u1_x.png')));
check('a plain name is salted in front', new RegExp(`^${SALT}image\\.png$`).test(saltFileName('image.png')));
check('two uploads of one name never share a key', saltFileName('image.png') !== saltFileName('image.png'));

check('a parseUser= name is filed under its user', keyForFileName('parseUser=u1_fileName=1_x.png') === 'user/u1/1_x.png');
check('so is the legacy form', keyForFileName('parseuser=u1_x.png') === 'user/u1/x.png');
check('a plain name is its own key', keyForFileName('ab_image.png') === 'ab_image.png');
check('a stored name is its own key', keyForFileName('user/u1/ab_x.png') === 'user/u1/ab_x.png');

// The bug: the key written has to be the key the returned name points at.
const salted = saltFileName('parseUser=oqZXhI8D0x_fileName=1791464255567_e2qfqz_Sitges2026plannerjpeg.jpeg');
check('the salt survives into the key',
  new RegExp(`^user/oqZXhI8D0x/${SALT}1791464255567_e2qfqz_Sitges2026plannerjpeg\\.jpeg$`).test(keyForFileName(salted)));
check('and the key maps to itself, so a stored name reads back the same object',
  keyForFileName(keyForFileName(salted)) === keyForFileName(salted));

const rewritten = saltUploadUrl('/files/parseUser%3Du1_fileName%3Dmy%20photo.jpg');
check('an encoded upload path is salted and stays encoded',
  new RegExp(`^/files/parseUser%3Du1_fileName%3D${SALT}my%20photo\\.jpg$`).test(rewritten));
check('a raw upload path decodes to the same salted name',
  new RegExp(`^parseUser=u1_fileName=${SALT}x\\.png$`).test(decodeURIComponent(saltUploadUrl('/files/parseUser=u1_fileName=x.png').slice(7))));
check('the query string is kept', /^\/files\/[0-9a-f]{16}_x\.png\?a=1$/.test(saltUploadUrl('/files/x.png?a=1')));
check('a path without a name is left to Parse', saltUploadUrl('/files') === '/files' && saltUploadUrl('/files/') === '/files/');
check('so is a nested path', saltUploadUrl('/files/a/b.png') === '/files/a/b.png');
check('and a name that does not decode', saltUploadUrl('/files/%E0%A4%A.png') === '/files/%E0%A4%A.png');

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
