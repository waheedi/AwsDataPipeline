#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudEngineerChallengeStack } from '../lib/cloud-engineer-challenge-stack';

const app = new cdk.App();

new CloudEngineerChallengeStack(app, 'CloudEngineerChallengeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1',
  },
});
