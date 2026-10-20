# AWS deployment status

Region: `ap-southeast-2` (Sydney).

## DynamoDB tables

The `peoples-management-dynamodb` CloudFormation stack creates **117 separate DynamoDB tables**, matching every entity in `database/schema-manifest.json`. Names use the prefix `peoples-management-`, followed by the original entity name. The primary key columns and numeric/string key types are preserved; three entities have two-part keys.

`dynamodb-tables.json` is the deployable CloudFormation template. `database/dynamodb-tables.json` is its readable key manifest. Regenerate both, and the TypeScript key definitions, with `npm run db:template`.

Tables use on-demand billing, deletion protection, and retain policies. Read/write throughput defaults to a maximum of 10 request units per second **per table**. These are best-effort throttles, not a total spending cap. Standard DynamoDB request and storage charges apply. No employee records or credentials are included in the template. Tables start empty.

The template adds no public table policy and no IAM role. Deployment uses the existing `CloudFormationRoleManager-ap-southeast-2-stack` service role. Application access must use a separate server-side IAM role scoped to the application tables; never put AWS keys in the frontend.

## Application migration is incomplete

`src/storage/dynamodb.ts` supplies native DynamoDB key reads, paginated listing, partition queries, version-checked writes and atomic transactions. `npm run test:dynamodb` checks key types, pagination, conflicting writes, transaction limits and service error handling.

**The existing API routes still use `src/lib/db.ts` and MySQL queries. The new storage layer is not yet connected to those routes.** Creating the tables does not make those queries compatible with DynamoDB. The current backend must not be presented as a working DynamoDB deployment.

Remaining migration work:

- Replace every MySQL query, join, database migration and seed path with DynamoDB operations and application-level relationship logic.
- Add secondary indexes for the final access patterns and transactional uniqueness checks for emails, codes and other unique fields.
- Preserve authorization scopes, reporting hierarchy rules, roster assignment rules, leave balances and performance review transitions under concurrent writes.
- Move uploaded files to durable object storage and configure the public HTTPS API URL.
- Provision the backend runtime with its own restricted IAM role, secrets and production settings.
- Run module integration tests against DynamoDB, then connect the Amplify frontend to that API and verify full user workflows.
- Remove the MySQL dependency/configuration and obsolete SQL scripts after the complete migration is verified.

Do not delete any existing AWS database before confirming the intended data migration or explicit deletion scope. The earlier local MySQL deletion did not change AWS resources.

## Frontend

GitHub repository: `a30088326-dotcom/frontend`, branch `main`.

Amplify app: `d1hm9lr657368h` (`peoples-management`).

Frontend URL: https://main.d1hm9lr657368h.amplifyapp.com

The frontend builds successfully. Amplify's SPA rewrite sends non-asset routes to `/index.html` with status 200; the direct `/login` URL was verified over HTTPS. Its API URL still needs to be set to the verified HTTPS backend endpoint after the backend migration and deployment. A rendered login page alone does not verify authentication or database integration.
