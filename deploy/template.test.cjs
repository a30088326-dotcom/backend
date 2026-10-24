const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const template = JSON.parse(fs.readFileSync(path.join(__dirname,'aws-backend.template.json'),'utf8'));
test('API compute defaults off until a digest-pinned native cutover is verified',()=>{
  assert.equal(template.Parameters.DeploymentReady.Default,'NO');
  assert.equal(template.Resources.ApiService.Condition,'DeployApi');
  assert.match(template.Parameters.ApiImage.AllowedPattern,/sha256/);
  assert.equal(template.Resources.ApiService.Properties.ScalingTarget.MaxTaskCount,2);
  assert.equal(template.Resources.ApiService.Properties.Cpu,'256');
  assert.equal(template.Resources.ApiService.Properties.Memory,'512');
});
test('upload data remains private encrypted versioned and retained',()=>{
  const bucket=template.Resources.UploadsBucket;
  assert.equal(bucket.DeletionPolicy,'Retain');
  assert.equal(bucket.Properties.VersioningConfiguration.Status,'Enabled');
  assert.ok(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(value=>value===true));
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,'AES256');
});
test('application role cannot create tables or access arbitrary secrets and S3 buckets',()=>{
  const policies=template.Resources.TaskRole.Properties.Policies[0].PolicyDocument.Statement;
  const actions=policies.flatMap(row=>row.Action);
  assert.ok(!actions.some(action=>action.includes('*')||/CreateTable|DeleteTable|iam:|secretsmanager:/.test(action)));
  assert.ok(JSON.stringify(policies).includes('${TablePrefix}-*'));
  assert.ok(JSON.stringify(policies).includes('${UploadsBucket.Arn}/uploads/*'));
});
test('no MySQL settings or frontend secrets are deployed',()=>{
  const env=template.Resources.ApiService.Properties.PrimaryContainer.Environment;
  assert.equal(env.find(value=>value.Name==='DATABASE_PROVIDER').Value,'dynamodb');
  assert.equal(env.find(value=>value.Name==='UPLOAD_STORAGE').Value,'s3');
  assert.ok(!env.some(value=>/DATABASE_URL|JWT_SECRET|SMTP_PASS/.test(value.Name)));
});
