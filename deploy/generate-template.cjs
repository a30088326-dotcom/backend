const fs = require('node:fs');
const path = require('node:path');
const ref = value => ({ Ref:value });
const sub = value => ({ 'Fn::Sub':value });
const att = (resource, attribute) => ({ 'Fn::GetAtt':[resource,attribute] });
const role = (service, properties) => ({ Type:'AWS::IAM::Role', Properties:{ AssumeRolePolicyDocument:{ Version:'2012-10-17',
  Statement:[{Effect:'Allow',Principal:{Service:service},Action:'sts:AssumeRole'}] }, ...properties } });
const policy = statements => ({PolicyName:'ApplicationAccess', PolicyDocument:{Version:'2012-10-17',Statement:statements}});
const template = {
  AWSTemplateFormatVersion:'2010-09-09',
  Description:'Peoples HR private upload storage and bounded ECS HTTPS API. Service stays disabled until native DynamoDB cutover is verified.',
  Parameters:{
    AppName:{Type:'String',Default:'peoples-management',AllowedPattern:'[a-z][a-z0-9-]{2,35}'},
    TablePrefix:{Type:'String',Default:'peoples-management',AllowedPattern:'[A-Za-z0-9_.-]{1,170}'},
    FrontendOrigin:{Type:'String',AllowedPattern:'https://[A-Za-z0-9.-]+',Description:'Exact Amplify production origin, no slash or path.'},
    ApiImage:{Type:'String',Default:'',AllowedPattern:'(^$)|(^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$)',Description:'Verified backend ECR image pinned by digest. No mutable latest tag.'},
    DeploymentReady:{Type:'String',AllowedValues:['NO','VERIFIED'],Default:'NO',Description:'Keep NO until native repository, SQL removal, import checks, uploads and workflows pass.'},
    SubnetIds:{Type:'List<AWS::EC2::Subnet::Id>',Description:'Two or more reviewed public subnets in the same VPC. No NAT gateway is provisioned by this template.'}
  },
  Conditions:{DeployApi:{'Fn::And':[{'Fn::Equals':[ref('DeploymentReady'),'VERIFIED']},{'Fn::Not':[{'Fn::Equals':[ref('ApiImage'),'']}]}]}},
  Resources:{
    UploadsBucket:{Type:'AWS::S3::Bucket',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{
      PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},
      OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},VersioningConfiguration:{Status:'Enabled'},
      BucketEncryption:{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
      LifecycleConfiguration:{Rules:[{Id:'AbortIncompleteUploads',Status:'Enabled',AbortIncompleteMultipartUpload:{DaysAfterInitiation:7}}]}
    }},
    UploadsBucketPolicy:{Type:'AWS::S3::BucketPolicy',Properties:{Bucket:ref('UploadsBucket'),PolicyDocument:{Version:'2012-10-17',Statement:[{
      Sid:'RequireTLS',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[att('UploadsBucket','Arn'),sub('${UploadsBucket.Arn}/*')],Condition:{Bool:{'aws:SecureTransport':'false'}}
    }]}}},
    ApiRepository:{Type:'AWS::ECR::Repository',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{
      RepositoryName:sub('${AppName}-api'),ImageTagMutability:'IMMUTABLE',ImageScanningConfiguration:{ScanOnPush:true},EncryptionConfiguration:{EncryptionType:'AES256'}
    }},
    RuntimeSecret:{Type:'AWS::SecretsManager::Secret',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{
      Description:'Peoples HR runtime secret. SMTP values must be configured privately before invitation email acceptance checks.',
      GenerateSecretString:{SecretStringTemplate:'{"SMTP_USER":"","SMTP_PASS":""}',GenerateStringKey:'JWT_SECRET',PasswordLength:64,ExcludePunctuation:true}
    }},
    LogGroup:{Type:'AWS::Logs::LogGroup',Properties:{RetentionInDays:30}},
    Cluster:{Type:'AWS::ECS::Cluster',Properties:{ClusterName:sub('${AppName}-api')}},
    ExecutionRole:role('ecs-tasks.amazonaws.com',{Policies:[policy([
      {Effect:'Allow',Action:['ecr:GetAuthorizationToken'],Resource:'*'},
      {Effect:'Allow',Action:['ecr:BatchGetImage','ecr:GetDownloadUrlForLayer','ecr:BatchCheckLayerAvailability'],Resource:att('ApiRepository','Arn')},
      {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:att('LogGroup','Arn')},
      {Effect:'Allow',Action:['secretsmanager:GetSecretValue'],Resource:ref('RuntimeSecret')}
    ])]}),
    InfrastructureRole:role('ecs.amazonaws.com',{ManagedPolicyArns:[sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices')]}),
    TaskRole:role('ecs-tasks.amazonaws.com',{Policies:[policy([
      {Effect:'Allow',Action:['dynamodb:DescribeTable','dynamodb:GetItem','dynamodb:BatchGetItem','dynamodb:Scan','dynamodb:Query','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:BatchWriteItem','dynamodb:ConditionCheckItem'],Resource:[sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TablePrefix}-*'),sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TablePrefix}-*/index/*')]},
      {Effect:'Allow',Action:['s3:ListBucket'],Resource:att('UploadsBucket','Arn')},
      {Effect:'Allow',Action:['s3:GetObject','s3:PutObject','s3:DeleteObject'],Resource:sub('${UploadsBucket.Arn}/uploads/*')}
    ])]}),
    ApiService:{Type:'AWS::ECS::ExpressGatewayService',Condition:'DeployApi',Properties:{
      ServiceName:sub('${AppName}-api'),Cluster:ref('Cluster'),InfrastructureRoleArn:att('InfrastructureRole','Arn'),ExecutionRoleArn:att('ExecutionRole','Arn'),TaskRoleArn:att('TaskRole','Arn'),Cpu:'256',Memory:'512',HealthCheckPath:'/health',
      NetworkConfiguration:{Subnets:ref('SubnetIds')},ScalingTarget:{MinTaskCount:1,MaxTaskCount:2,AutoScalingMetric:'AVERAGE_CPU',AutoScalingTargetValue:70},
      PrimaryContainer:{Image:ref('ApiImage'),ContainerPort:3001,AwsLogsConfiguration:{LogGroup:ref('LogGroup'),LogStreamPrefix:'api'},
        Environment:[['NODE_ENV','production'],['PORT','3001'],['TZ','Asia/Colombo'],['DATABASE_PROVIDER','dynamodb'],['UPLOAD_STORAGE','s3'],['AWS_REGION',ref('AWS::Region')],['DYNAMODB_TABLE_PREFIX',ref('TablePrefix')],['UPLOADS_BUCKET',ref('UploadsBucket')],['FRONTEND_URL',ref('FrontendOrigin')],['EXTERNAL_FRONTEND_URL',ref('FrontendOrigin')],['SMTP_HOST','smtp.gmail.com'],['SMTP_PORT','587'],['SMTP_SECURE','false']].map(([Name,Value])=>({Name,Value})),
        Secrets:['JWT_SECRET','SMTP_USER','SMTP_PASS'].map(Name=>({Name,ValueFrom:sub('${RuntimeSecret}:'+Name+'::')}))}
    }}
  },
  Outputs:{UploadsBucket:{Value:ref('UploadsBucket')},RepositoryUri:{Value:att('ApiRepository','RepositoryUri')},RuntimeSecretArn:{Value:ref('RuntimeSecret')},
    ApiEndpoint:{Condition:'DeployApi',Value:att('ApiService','Endpoint')},ApplicationTaskRoleArn:{Value:att('TaskRole','Arn')}}
};
const output = path.join(__dirname,'aws-backend.template.json');
fs.writeFileSync(output,JSON.stringify(template,null,2)+'\n');
console.log('Generated reviewable AWS template:',output);
