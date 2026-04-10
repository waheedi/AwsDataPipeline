import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codestarconnections from 'aws-cdk-lib/aws-codestarconnections';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class CloudEngineerChallengeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubOwner = new cdk.CfnParameter(this, 'GitHubOwner', {
      type: 'String',
      default: 'waheedi',
      description: 'GitHub organization or user that owns the repository.',
    });

    const githubRepository = new cdk.CfnParameter(this, 'GitHubRepository', {
      type: 'String',
      default: 'AwsDataPipeline',
      description: 'GitHub repository name for the challenge code.',
    });

    const githubBranch = new cdk.CfnParameter(this, 'GitHubBranch', {
      type: 'String',
      default: 'master',
      description: 'GitHub branch that triggers deployments to Dev.',
    });

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

    const pipelineAlertsTopic = new sns.Topic(this, 'PipelineAlertsTopic', {
      topicName: 'data-pipeline-alerts',
    });

    const invokeLambdaA = new tasks.LambdaInvoke(this, 'InvokeLambdaA', {
      lambdaFunction: lambdaA,
      payloadResponseOnly: true,
      resultPath: '$.lambdaA',
    });

    const waitBeforeRetry = new sfn.Wait(this, 'WaitBeforeRetry', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    const processSingleOrder = new tasks.LambdaInvoke(this, 'ProcessSingleOrder', {
      lambdaFunction: lambdaB,
      payloadResponseOnly: true,
      resultPath: sfn.JsonPath.DISCARD,
    });

    const notifyOrderProcessingFailure = new tasks.SnsPublish(this, 'NotifyOrderProcessingFailure', {
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

    const markOrderFailureHandled = new sfn.Pass(this, 'MarkOrderFailureHandled');
    notifyOrderProcessingFailure.next(markOrderFailureHandled);
    processSingleOrder.addCatch(notifyOrderProcessingFailure, {
      resultPath: '$.error',
    });

    const processOrders = new sfn.Map(this, 'ProcessOrders', {
      itemsPath: sfn.JsonPath.stringAt('$.lambdaA.orders'),
      resultPath: sfn.JsonPath.DISCARD,
      maxConcurrency: 10,
    });
    processOrders.itemProcessor(processSingleOrder);

    const notifyProcessingFailure = new tasks.SnsPublish(this, 'NotifyProcessingFailure', {
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

    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      error: 'LambdaBProcessingFailed',
      cause: 'One or more orders failed in LambdaB. Notification published.',
    });

    processOrders.addCatch(notifyProcessingFailure, {
      resultPath: '$.error',
    });
    notifyProcessingFailure.next(pipelineFailed);

    const pipelineSucceeded = new sfn.Succeed(this, 'PipelineSucceeded');
    processOrders.next(pipelineSucceeded);

    const resultsReadyChoice = new sfn.Choice(this, 'ResultsReady');
    resultsReadyChoice.when(
      sfn.Condition.booleanEquals('$.lambdaA.results', true),
      processOrders,
    );
    resultsReadyChoice.otherwise(waitBeforeRetry);
    waitBeforeRetry.next(invokeLambdaA);

    const dataPipelineStateMachine = new sfn.StateMachine(this, 'DataPipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(invokeLambdaA.next(resultsReadyChoice)),
      timeout: cdk.Duration.minutes(10),
    });

    const pipelineScheduleRule = new events.Rule(this, 'DataPipelineScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: 'Trigger the data pipeline on a fixed schedule.',
    });

    pipelineScheduleRule.addTarget(new targets.SfnStateMachine(dataPipelineStateMachine));

    const githubConnection = new codestarconnections.CfnConnection(this, 'GitHubConnection', {
      connectionName: 'cloud-engineer-challenge-github',
      providerType: 'GitHub',
    });

    const sourceOutput = new codepipeline.Artifact();

    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
      environmentVariables: {
        AWS_REGION: {
          value: 'eu-west-1',
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '20',
            },
            commands: [
              'npm ci',
            ],
          },
          build: {
            commands: [
              'npm run build',
              'npm run synth',
              'npx cdk deploy CloudEngineerChallengeStack --require-approval never',
            ],
          },
        },
      }),
    });

    // Sandbox-focused scope for speed; tighten this to least-privilege for production use.
    deployProject.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
    );

    const deploymentPipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      pipelineName: 'cloud-engineer-challenge-dev',
      crossAccountKeys: false,
      pipelineType: codepipeline.PipelineType.V2,
    });

    deploymentPipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipelineActions.CodeStarConnectionsSourceAction({
          actionName: 'GitHubSource',
          owner: githubOwner.valueAsString,
          repo: githubRepository.valueAsString,
          branch: githubBranch.valueAsString,
          output: sourceOutput,
          connectionArn: githubConnection.attrConnectionArn,
          triggerOnPush: true,
        }),
      ],
    });

    deploymentPipeline.addStage({
      stageName: 'DeployDev',
      actions: [
        new codepipelineActions.CodeBuildAction({
          actionName: 'CdkDeployDev',
          project: deployProject,
          input: sourceOutput,
        }),
      ],
    });

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

    new cdk.CfnOutput(this, 'DataPipelineStateMachineArn', {
      value: dataPipelineStateMachine.stateMachineArn,
    });

    new cdk.CfnOutput(this, 'PipelineAlertsTopicArn', {
      value: pipelineAlertsTopic.topicArn,
    });

    new cdk.CfnOutput(this, 'CodePipelineName', {
      value: deploymentPipeline.pipelineName,
    });

    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: githubConnection.attrConnectionArn,
      description: 'Complete the GitHub connection handshake in AWS Console before first pipeline run.',
    });
  }
}
