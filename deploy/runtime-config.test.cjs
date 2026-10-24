const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuntimeConfig } = require('./runtime-config.cjs');
const valid = { DATABASE_PROVIDER:'dynamodb', UPLOAD_STORAGE:'s3', AWS_REGION:'ap-southeast-2', DYNAMODB_TABLE_PREFIX:'peoples-management',
  UPLOADS_BUCKET:'private-hr-documents-123456', JWT_SECRET:'test-only-generated-secret-that-is-long-enough',
  FRONTEND_URL:'https://main.example.amplifyapp.com', EXTERNAL_FRONTEND_URL:'https://main.example.amplifyapp.com' };
test('hosted runtime accepts explicit DynamoDB and private upload configuration', () => validateRuntimeConfig(valid));
for(const [name, changes] of Object.entries({ mysql:{DATABASE_PROVIDER:'mysql'}, fallback:{DATABASE_URL:'mysql://unused'}, disk:{UPLOAD_STORAGE:'local'},
  publicOrigin:{FRONTEND_URL:'*'}, localOrigin:{FRONTEND_URL:'http://localhost:5174'}, mismatch:{EXTERNAL_FRONTEND_URL:'https://different.example.com'},
  secret:{JWT_SECRET:'short'}, region:{AWS_REGION:''}, prefix:{DYNAMODB_TABLE_PREFIX:'../invalid'}, bucket:{UPLOADS_BUCKET:''} })) {
  test(`hosted runtime refuses ${name}`, () => assert.throws(() => validateRuntimeConfig({...valid,...changes})));
}
