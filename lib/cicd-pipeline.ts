import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codestarconnections from 'aws-cdk-lib/aws-codestarconnections';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface CicdResources {
  deploymentPipeline: codepipeline.Pipeline;
  githubConnection: codestarconnections.CfnConnection;
}

export function createCicdPipeline(scope: cdk.Stack): CicdResources {
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

  const githubConnection = new codestarconnections.CfnConnection(scope, 'GitHubConnection', {
    connectionName: 'cloud-engineer-challenge-github',
    providerType: 'GitHub',
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

  const deploymentPipeline = new codepipeline.Pipeline(scope, 'DeploymentPipeline', {
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

  return {
    deploymentPipeline,
    githubConnection,
  };
}
