import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface CicdResources {
  deploymentPipeline: codepipeline.Pipeline;
  githubConnectionArn: string;
  deploymentPipelineAlertsTopic: sns.Topic;
}

export function createCicdPipeline(scope: cdk.Stack): CicdResources {
  const deploymentEnvironment = new cdk.CfnParameter(scope, 'DeploymentEnvironment', {
    type: 'String',
    default: 'dev',
    description: 'Target deployment environment name (e.g. dev/staging/prod).',
  });

  const githubConnectionArn = new cdk.CfnParameter(scope, 'GitHubConnectionArn', {
    type: 'String',
    default: 'arn:aws:codeconnections:us-east-1:844682013548:connection/001a2f2e-f6ae-484d-8664-197f5cb76dc6',
    description: 'Existing CodeConnections ARN used by CodePipeline source action.',
  });

  const githubOwner = new cdk.CfnParameter(scope, 'GitHubOwner', {
    type: 'String',
    default: 'waheedi',
    description: 'GitHub organization or user that owns the repository.',
  });

  const githubRepository = new cdk.CfnParameter(scope, 'GitHubRepository', {
    type: 'String',
    default: 'AwsDataPipeline',
    description: 'GitHub repository name for the challenge code.',
  });

  const githubBranch = new cdk.CfnParameter(scope, 'GitHubBranch', {
    type: 'String',
    default: 'master',
    description: 'GitHub branch that triggers deployments to Dev.',
  });

  const sourceOutput = new codepipeline.Artifact();

  const deployProject = new codebuild.PipelineProject(scope, 'DeployProject', {
    environment: {
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
    },
    environmentVariables: {
      AWS_REGION: {
        value: 'eu-west-1',
      },
      DEPLOY_ENV: {
        value: deploymentEnvironment.valueAsString,
      },
      GITHUB_CONNECTION_ARN: {
        value: githubConnectionArn.valueAsString,
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
            'npx cdk deploy CloudEngineerChallengeStack --require-approval never --parameters DeploymentEnvironment=$DEPLOY_ENV --parameters GitHubConnectionArn=$GITHUB_CONNECTION_ARN',
          ],
        },
      },
    }),
  });

  // Sandbox-focused scope for speed; tighten this to least-privilege for production use.
  deployProject.role?.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
  );

  const deploymentPipeline = new codepipeline.Pipeline(scope, 'DeploymentPipeline', {
    pipelineName: `cloud-engineer-challenge-${deploymentEnvironment.valueAsString}`,
    crossAccountKeys: false,
    pipelineType: codepipeline.PipelineType.V2,
    executionMode: codepipeline.ExecutionMode.QUEUED,
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
        connectionArn: githubConnectionArn.valueAsString,
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

  const deploymentPipelineAlertsTopic = new sns.Topic(scope, 'DeploymentPipelineAlertsTopic');

  const deploymentPipelineFailureRule = new events.Rule(scope, 'DeploymentPipelineFailureRule', {
    description: 'Send SNS notifications when deployment pipeline execution fails.',
    eventPattern: {
      source: ['aws.codepipeline'],
      detailType: ['CodePipeline Pipeline Execution State Change'],
      detail: {
        pipeline: [deploymentPipeline.pipelineName],
        state: ['FAILED'],
      },
    },
  });

  deploymentPipelineFailureRule.addTarget(new targets.SnsTopic(deploymentPipelineAlertsTopic, {
    message: events.RuleTargetInput.fromObject({
      pipeline: events.EventField.fromPath('$.detail.pipeline'),
      state: events.EventField.fromPath('$.detail.state'),
      executionId: events.EventField.fromPath('$.detail.execution-id'),
      region: events.EventField.fromPath('$.region'),
      time: events.EventField.fromPath('$.time'),
      note: 'CodePipeline execution failed. Subscribe this topic with email or webhook for alerts.',
    }),
  }));

  return {
    deploymentPipeline,
    githubConnectionArn: githubConnectionArn.valueAsString,
    deploymentPipelineAlertsTopic,
  };
}
