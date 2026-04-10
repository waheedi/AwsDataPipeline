import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class CloudEngineerChallengeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'record_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const orderResultsBucket = new s3.Bucket(this, 'OrderResultsBucket', {
      bucketName: `order-results-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const postLambda = new lambda.Function(this, 'PostLambda', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src', 'post_lambda')),
      handler: 'app.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      environment: {
        TABLE_NAME: ordersTable.tableName,
      },
    });

    const lambdaA = new lambda.Function(this, 'LambdaA', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src', 'lambda_a')),
      handler: 'app.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_12,
    });

    const lambdaB = new lambda.Function(this, 'LambdaB', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src', 'lambda_b')),
      handler: 'app.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      environment: {
        LOG_BUCKET: orderResultsBucket.bucketName,
      },
    });

    ordersTable.grantWriteData(postLambda);
    orderResultsBucket.grantPut(lambdaB);

    const api = new apigateway.RestApi(this, 'OrdersApi', {
      restApiName: 'orders-api',
      deployOptions: {
        stageName: 'dev',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    api.root.addResource('orders').addMethod('POST', new apigateway.LambdaIntegration(postLambda));

    new cdk.CfnOutput(this, 'OrdersApiUrl', {
      value: `${api.url}orders`,
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: ordersTable.tableName,
    });

    new cdk.CfnOutput(this, 'OrderResultsBucketName', {
      value: orderResultsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'LambdaAName', {
      value: lambdaA.functionName,
    });

    new cdk.CfnOutput(this, 'LambdaBName', {
      value: lambdaB.functionName,
    });
  }
}
