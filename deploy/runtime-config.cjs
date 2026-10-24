function validateRuntimeConfig(env) {
  if (env.DATABASE_PROVIDER !== 'dynamodb') throw new Error('AWS deployment requires DATABASE_PROVIDER=dynamodb.');
  if (env.DATABASE_URL) throw new Error('Remove DATABASE_URL from the AWS deployment. No MySQL fallback is allowed.');
  if (env.UPLOAD_STORAGE !== 's3') throw new Error('AWS deployment requires private S3 upload storage.');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(env.AWS_REGION || '')) throw new Error('AWS_REGION is required.');
  if (!/^[a-zA-Z0-9_.-]{1,170}$/.test(env.DYNAMODB_TABLE_PREFIX || '')) throw new Error('DynamoDB table prefix is required.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.UPLOADS_BUCKET || '')) throw new Error('Private upload bucket is required.');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /REPLACE|YOUR_|CHANGE_ME/i.test(env.JWT_SECRET)) throw new Error('A strong JWT signing secret must come from Secrets Manager.');
  const origins = (env.FRONTEND_URL || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value || /localhost|127\.0\.0\.1/.test(url.hostname); }
    catch { return true; }
  })) throw new Error('FRONTEND_URL must contain explicit HTTPS browser origins.');
  if (!origins.includes(env.EXTERNAL_FRONTEND_URL)) throw new Error('EXTERNAL_FRONTEND_URL must match an allowed frontend origin.');
}
module.exports = { validateRuntimeConfig };
