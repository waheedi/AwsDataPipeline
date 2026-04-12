# Architecture Decisions

This document captures the key implementation decisions for the Entrix Cloud Engineer challenge and why they were chosen.

## 1) Orchestration: Step Functions for the data pipeline

- Decision: Use AWS Step Functions as the control plane for Lambda A and Lambda B execution.
- Why:
  - Native support for branching, retry loops, map/fan-out, and error handling.
  - Clear visual workflow and execution history for debugging and evaluation.
  - Better operational visibility than custom loop logic inside a Lambda function.
- Tradeoff:
  - Slightly higher service complexity than a single Lambda orchestrator.
- Outcome:
  - Implemented `InvokeLambdaA -> ResultsReady choice -> WaitBeforeRetry loop -> ProcessOrders map`.

## 2) Scheduling: EventBridge rule to trigger the pipeline

- Decision: Use EventBridge scheduled rule (`rate(15 minutes)`) to start the state machine.
- Why:
  - Native serverless scheduler with no always-on compute.
  - Reliable and cost-efficient periodic triggering.
- Tradeoff:
  - Requires explicit disablement when cost control/testing pauses are needed.
- Outcome:
  - Rule created and later manually disabled to pause recurring cost during development.

## 3) Failure notifications: SNS as Slack-compatible notification abstraction

- Decision: Publish pipeline/order errors to an SNS topic.
- Why:
  - SNS is decoupled and can fan out to email, Lambda, HTTPS webhook, etc.
  - Meets “Slack or similar app” requirement without hard-coding a third-party integration.
- Tradeoff:
  - No direct Slack delivery until a subscriber is configured.
- Outcome:
  - Implemented order-level and fatal-level publish paths with execution/error context.

## 4) Persistence for POST API records: DynamoDB with TTL

- Decision: Store incoming orders in DynamoDB and attach a 24-hour TTL field.
- Why:
  - Serverless, scalable, low-ops, and matches short-lived data retention requirement.
  - TTL offloads data expiry cleanup to AWS.
- Tradeoff:
  - TTL expiry is asynchronous (not hard deletion exactly at 24h boundary).
- Outcome:
  - Table with `record_id` partition key and `expires_at` TTL attribute.

## 5) Storage of accepted pipeline output: S3 bucket

- Decision: Store accepted order outputs as JSON objects in S3.
- Why:
  - Durable, cheap object storage ideal for pipeline artifacts/results.
  - Straightforward integration from Lambda B.
- Tradeoff:
  - Requires naming/object structure discipline for downstream analytics use.
- Outcome:
  - Bucket configured and tested with accepted-order object writes.

## 6) API layer: API Gateway REST API + Lambda proxy

- Decision: Use API Gateway with `POST /orders` to invoke the POST Lambda.
- Why:
  - Fully serverless HTTP ingestion path.
  - Native auth/throttling/extensions available if expanded later.
- Tradeoff:
  - Adds API Gateway cost/latency compared with direct service integration.
- Outcome:
  - Endpoint deployed and integrated with Lambda.

## 7) Lambda dependency packaging strategy

- Decision: Keep only `requirements.txt` in source and install Lambda B Python dependencies during CDK asset bundling.
- Why:
  - Avoids committing vendored third-party libraries to Git.
  - Keeps Lambda packaging deterministic while supporting both local bundling and Docker fallback.
- Tradeoff:
  - Slightly longer synth/deploy time because dependencies are installed at build time.
- Outcome:
  - Lambda B dependency artifacts are generated during bundle/synth, not stored in repository history.

## 8) Infrastructure deployment approach: CDK in TypeScript

- Decision: Implement all infra via AWS CDK TypeScript in one stack.
- Why:
  - Matches challenge requirement and supports composable AWS constructs.
  - Improves reproducibility and reviewability versus manual setup.
- Tradeoff:
  - Requires bootstrap and pipeline build permissions alignment.
- Outcome:
  - Stack deployed successfully to `eu-west-1`.

## 9) CI/CD: CodePipeline + CodeBuild from GitHub `master`

- Decision: Use CodePipeline source from GitHub (CodeStar connection) and deploy via CodeBuild.
- Why:
  - Native AWS-managed pipeline for continuous deployment from merges to `master`.
  - Directly satisfies “deploy from GitHub to AWS account” requirement.
- Tradeoff:
  - Requires CodeStar connection handshake in AWS Console.
  - Current sandbox implementation uses broad deploy permissions for speed.
- Outcome:
  - Pipeline resources are codified and configured for push-triggered Dev deployments.

## 10) GitHub Actions role in the workflow

- Decision: Add GitHub Actions workflow for `master` and PRs to run `npm ci`, CDK construct tests, and `synth`.
- Why:
  - Fast feedback before or alongside AWS deployment pipeline execution.
  - Catches regressions in infrastructure intent via assertions, not only type/synth checks.
- Tradeoff:
  - Does not deploy directly; deployment remains AWS CodePipeline’s responsibility.
- Outcome:
  - CI workflow added under `.github/workflows/ci.yml`.

## 11) Cost and lifecycle posture for challenge environment

- Decision: Use `RemovalPolicy.DESTROY` and auto-delete objects for non-production challenge stack.
- Why:
  - Fast iteration and easy cleanup in sandbox account.
  - Prevents long-lived accidental spend during evaluation.
- Tradeoff:
  - Not production-safe default for critical data retention.
- Outcome:
  - Suitable for challenge/sandbox; should be hardened for production environments.

## 12) Security posture and explicit sandbox tradeoffs

- Decision: Prioritize delivery speed in sandbox where needed (for example broad deploy permissions in CI/CD).
- Why:
  - Keeps momentum for assessment deadlines.
- Tradeoff:
  - Not least-privilege; should be tightened in a production implementation.
- Outcome:
  - Documented as intentional challenge-phase compromise and easy future hardening target.

## 13) Code organization: split infrastructure logic across multiple TypeScript modules

- Decision: Split CDK implementation into separate files by concern:
  - `lib/data-plane.ts` for runtime/serverless resources
  - `lib/cicd-pipeline.ts` for deployment pipeline resources
  - `lib/cloud-engineer-challenge-stack.ts` as thin composition layer
- Why:
  - Improves readability, reviewability, and maintainability.
  - Reduces cognitive load when iterating on either runtime or CI/CD components.
- Tradeoff:
  - Slightly more files/import wiring.
- Outcome:
  - Cleaner structure without changing the deployed resource model.

## 14) Optional quality gate: CDK construct tests with `aws-cdk-lib/assertions`

- Decision: Add CDK-level tests covering core requirements and optional controls.
- Why:
  - Gives deterministic checks for orchestration, TTL, CI/CD shape, and alerting resources.
  - Satisfies optional requirement to test constructs and run those tests in CI.
- Tradeoff:
  - Tests assert template intent, not runtime behavior.
- Outcome:
  - Added tests in `test/cdk.test.ts` and wired execution in GitHub Actions.

## 15) Optional deployment-failure notifications: EventBridge -> SNS

- Decision: Add a dedicated SNS topic and EventBridge rule for CodePipeline execution failures.
- Why:
  - Meets optional requirement for deployment pipeline failure notifications.
  - Keeps notifications decoupled and extensible (email, webhook, Lambda subscriber).
- Tradeoff:
  - Requires subscriber setup to deliver to a human destination.
- Outcome:
  - `DeploymentPipelineFailureRule` publishes failure context to `DeploymentPipelineAlertsTopic`.

## 16) CI/CD environment switchability

- Decision: Introduce `DeploymentEnvironment` and `GitHubConnectionArn` stack parameters and pass them through CodeBuild.
- Why:
  - Enables controlled environment naming and connection selection without code edits.
  - Supports future environment promotion patterns with parameterized deploys.
- Tradeoff:
  - Adds parameter management responsibility during deployments.
- Outcome:
  - Pipeline name and deploy command are now parameterized for environment-aware operation.
