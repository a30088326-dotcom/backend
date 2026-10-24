const { validateRuntimeConfig } = require('./runtime-config.cjs');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { tableDefinitions } = require('../dist/storage/table-definitions.js');

async function main() {
  validateRuntimeConfig(process.env);
  const db = new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 5 });
  const names = Object.keys(tableDefinitions);
  if (names.length < 117) throw new Error('The complete application table manifest is missing entities.');
  // Bounded batches avoid throttling the control-plane API during rolling deployment.
  for (let offset = 0; offset < names.length; offset += 4) {
    await Promise.all(names.slice(offset, offset + 4).map(async entity => {
      const result = await db.send(new DescribeTableCommand({ TableName: `${process.env.DYNAMODB_TABLE_PREFIX}-${entity}` }));
      const expected = tableDefinitions[entity];
      const keys = [expected.partitionKey, expected.sortKey].filter(Boolean);
      if (result.Table?.TableStatus !== 'ACTIVE' || result.Table.KeySchema?.length !== keys.length ||
        keys.some((key, index) => !result.Table.KeySchema.some(value => value.AttributeName === key.name && value.KeyType === (index ? 'RANGE' : 'HASH')) ||
          !result.Table.AttributeDefinitions?.some(value => value.AttributeName === key.name && value.AttributeType === key.type))) {
        throw new Error(`DynamoDB table is not ready: ${entity}`);
      }
    }));
  }
  await new S3Client({ region: process.env.AWS_REGION, maxAttempts: 5 }).send(new HeadBucketCommand({ Bucket: process.env.UPLOADS_BUCKET }));
  console.log(`AWS startup verified: ${names.length} DynamoDB table schemas and private upload bucket.`);
  require('../dist/server.js');
}
main().catch(error => { console.error('AWS startup refused:', error.message); process.exitCode = 1; });
