import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface DataPlaneResources {
  api: apigateway.RestApi;
  ordersTable: dynamodb.Table;
  orderResultsBucket: s3.Bucket;
  lambdaA: lambda.Function;
  lambdaB: lambda.Function;
  dataPipelineStateMachine: sfn.StateMachine;
  pipelineAlertsTopic: sns.Topic;
}

export function createDataPlane(scope: cdk.Stack): DataPlaneResources {
  const candidateRoots = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  ];
  const projectRoot = candidateRoots.find((candidate) => (
    fs.existsSync(path.join(candidate, 'src', 'post_lambda'))
  )) ?? path.resolve(__dirname, '..');

  const ordersTable = new dynamodb.Table(scope, 'OrdersTable', {
    partitionKey: { name: 'record_id', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expires_at',
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  const orderResultsBucket = new s3.Bucket(scope, 'OrderResultsBucket', {
    bucketName: `order-results-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });

  const postLambda = new lambda.Function(scope, 'PostLambda', {
    code: lambda.Code.fromAsset(path.join(projectRoot, 'src', 'post_lambda')),
    handler: 'app.lambda_handler',
    runtime: lambda.Runtime.PYTHON_3_12,
    environment: {
      TABLE_NAME: ordersTable.tableName,
    },
  });

  const lambdaA = new lambda.Function(scope, 'LambdaA', {
    code: lambda.Code.fromAsset(path.join(projectRoot, 'src', 'lambda_a')),
    handler: 'app.lambda_handler',
    runtime: lambda.Runtime.PYTHON_3_12,
  });

  const lambdaB = new lambda.Function(scope, 'LambdaB', {
    code: lambda.Code.fromAsset(path.join(projectRoot, 'src', 'lambda_b')),
    handler: 'app.lambda_handler',
    runtime: lambda.Runtime.PYTHON_3_12,
    environment: {
      LOG_BUCKET: orderResultsBucket.bucketName,
    },
  });

  ordersTable.grantWriteData(postLambda);
  orderResultsBucket.grantPut(lambdaB);

  const pipelineAlertsTopic = new sns.Topic(scope, 'PipelineAlertsTopic', {
    topicName: 'data-pipeline-alerts',
  });

  const invokeLambdaA = new tasks.LambdaInvoke(scope, 'InvokeLambdaA', {
    lambdaFunction: lambdaA,
    payloadResponseOnly: true,
    resultPath: '$.lambdaA',
  });

  const waitBeforeRetry = new sfn.Wait(scope, 'WaitBeforeRetry', {
    time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
  });

  const processSingleOrder = new tasks.LambdaInvoke(scope, 'ProcessSingleOrder', {
    lambdaFunction: lambdaB,
    payloadResponseOnly: true,
    resultPath: sfn.JsonPath.DISCARD,
  });

  const notifyOrderProcessingFailure = new tasks.SnsPublish(scope, 'NotifyOrderProcessingFailure', {
    topic: pipelineAlertsTopic,
    subject: 'Order Processing Failure',
    message: sfn.TaskInput.fromObject({
      error: sfn.JsonPath.stringAt('$.error.Error'),
      cause: sfn.JsonPath.stringAt('$.error.Cause'),
      order: sfn.JsonPath.objectAt('$'),
      executionArn: sfn.JsonPath.stringAt('$$.Execution.Id'),
      note: 'Order failed in LambdaB. Notify Slack/webhook subscriber from this SNS topic.',
    }),
    resultPath: sfn.JsonPath.DISCARD,
  });

  const markOrderFailureHandled = new sfn.Pass(scope, 'MarkOrderFailureHandled');
  notifyOrderProcessingFailure.next(markOrderFailureHandled);
  processSingleOrder.addCatch(notifyOrderProcessingFailure, {
    resultPath: '$.error',
  });

  const processOrders = new sfn.Map(scope, 'ProcessOrders', {
    itemsPath: sfn.JsonPath.stringAt('$.lambdaA.orders'),
    resultPath: sfn.JsonPath.DISCARD,
    maxConcurrency: 10,
  });
  processOrders.itemProcessor(processSingleOrder);

  const notifyProcessingFailure = new tasks.SnsPublish(scope, 'NotifyProcessingFailure', {
    topic: pipelineAlertsTopic,
    subject: 'Data Pipeline Fatal Failure',
    message: sfn.TaskInput.fromObject({
      error: sfn.JsonPath.stringAt('$.error.Error'),
      cause: sfn.JsonPath.stringAt('$.error.Cause'),
      executionArn: sfn.JsonPath.stringAt('$$.Execution.Id'),
      stateMachine: sfn.JsonPath.stringAt('$$.StateMachine.Name'),
      note: 'Notify Slack/webhook subscriber from this SNS topic.',
    }),
    resultPath: sfn.JsonPath.DISCARD,
  });

  const pipelineFailed = new sfn.Fail(scope, 'PipelineFailed', {
    error: 'LambdaBProcessingFailed',
    cause: 'One or more orders failed in LambdaB. Notification published.',
  });

  processOrders.addCatch(notifyProcessingFailure, {
    resultPath: '$.error',
  });
  notifyProcessingFailure.next(pipelineFailed);

  const pipelineSucceeded = new sfn.Succeed(scope, 'PipelineSucceeded');
  processOrders.next(pipelineSucceeded);

  const resultsReadyChoice = new sfn.Choice(scope, 'ResultsReady');
  resultsReadyChoice.when(
    sfn.Condition.booleanEquals('$.lambdaA.results', true),
    processOrders,
  );
  resultsReadyChoice.otherwise(waitBeforeRetry);
  waitBeforeRetry.next(invokeLambdaA);

  const dataPipelineStateMachine = new sfn.StateMachine(scope, 'DataPipelineStateMachine', {
    definitionBody: sfn.DefinitionBody.fromChainable(invokeLambdaA.next(resultsReadyChoice)),
    timeout: cdk.Duration.minutes(10),
  });

  const pipelineScheduleRule = new events.Rule(scope, 'DataPipelineScheduleRule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    description: 'Trigger the data pipeline on a fixed schedule.',
  });

  pipelineScheduleRule.addTarget(new targets.SfnStateMachine(dataPipelineStateMachine));

  const api = new apigateway.RestApi(scope, 'OrdersApi', {
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

  return {
    api,
    ordersTable,
    orderResultsBucket,
    lambdaA,
    lambdaB,
    dataPipelineStateMachine,
    pipelineAlertsTopic,
  };
}
