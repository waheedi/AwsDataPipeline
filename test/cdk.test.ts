import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudEngineerChallengeStack } from '../lib/cloud-engineer-challenge-stack';

function synthTemplate(): Template {
  const app = new App();
  const stack = new CloudEngineerChallengeStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'eu-west-1' },
  });
  return Template.fromStack(stack);
}

test('orders table enables TTL using expires_at', () => {
  const template = synthTemplate();

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TimeToLiveSpecification: {
      AttributeName: 'expires_at',
      Enabled: true,
    },
  });
});

test('state machine keeps polling Lambda A until results are ready', () => {
  const template = synthTemplate();
  const resources = template.findResources('AWS::StepFunctions::StateMachine');
  const stateMachine = Object.values(resources)[0] as Record<string, unknown> | undefined;

  assert.ok(stateMachine, 'Expected one Step Functions state machine resource');
  const serializedStateMachine = JSON.stringify(stateMachine);
  assert.match(serializedStateMachine, /InvokeLambdaA/);
  assert.match(serializedStateMachine, /ResultsReady/);
  assert.match(serializedStateMachine, /WaitBeforeRetry/);
  assert.match(serializedStateMachine, /ProcessOrders/);
});

test('codepipeline uses codestar source connection and v2 triggers', () => {
  const template = synthTemplate();

  template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
    PipelineType: 'V2',
    Stages: Match.arrayWith([
      Match.objectLike({
        Name: 'Source',
        Actions: Match.arrayWith([
          Match.objectLike({
            ActionTypeId: Match.objectLike({
              Category: 'Source',
              Provider: 'CodeStarSourceConnection',
            }),
            Configuration: Match.objectLike({
              ConnectionArn: Match.anyValue(),
              DetectChanges: true,
              FullRepositoryId: Match.anyValue(),
            }),
          }),
        ]),
      }),
    ]),
  });
});

test('deployment pipeline failure notifications publish to SNS', () => {
  const template = synthTemplate();

  template.resourceCountIs('AWS::SNS::Topic', 2);

  template.hasResourceProperties('AWS::Events::Rule', {
    Description: 'Send SNS notifications when deployment pipeline execution fails.',
    EventPattern: {
      source: ['aws.codepipeline'],
      'detail-type': ['CodePipeline Pipeline Execution State Change'],
      detail: Match.objectLike({
        pipeline: Match.anyValue(),
        state: ['FAILED'],
      }),
    },
    Targets: Match.arrayWith([
      Match.objectLike({
        Arn: Match.anyValue(),
      }),
    ]),
  });
});
