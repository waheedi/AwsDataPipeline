import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createCicdPipeline } from './cicd-pipeline';
import { createDataPlane } from './data-plane';

export class CloudEngineerChallengeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dataPlane = createDataPlane(this);
    const cicd = createCicdPipeline(this);

    new cdk.CfnOutput(this, 'OrdersApiUrl', {
      value: dataPlane.api.urlForPath('/orders'),
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: dataPlane.ordersTable.tableName,
    });

    new cdk.CfnOutput(this, 'OrderResultsBucketName', {
      value: dataPlane.orderResultsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'LambdaAName', {
      value: dataPlane.lambdaA.functionName,
    });

    new cdk.CfnOutput(this, 'LambdaBName', {
      value: dataPlane.lambdaB.functionName,
    });

    new cdk.CfnOutput(this, 'DataPipelineStateMachineArn', {
      value: dataPlane.dataPipelineStateMachine.stateMachineArn,
    });

    new cdk.CfnOutput(this, 'PipelineAlertsTopicArn', {
      value: dataPlane.pipelineAlertsTopic.topicArn,
    });

    new cdk.CfnOutput(this, 'CodePipelineName', {
      value: cicd.deploymentPipeline.pipelineName,
    });

    new cdk.CfnOutput(this, 'ActiveGitHubConnectionArn', {
      value: cicd.githubConnectionArn,
    });

    new cdk.CfnOutput(this, 'DeploymentPipelineAlertsTopicArn', {
      value: cicd.deploymentPipelineAlertsTopic.topicArn,
      description: 'SNS topic for deployment pipeline execution failure alerts.',
    });
  }
}
