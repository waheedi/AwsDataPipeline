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

- Decision: Vendor `requests` dependency directly inside `src/lambda_b` source tree.
- Why:
  - Avoids Docker-based Python bundling dependency in this environment.
  - Keeps deployment deterministic for the challenge setup.
- Tradeoff:
  - Larger repository footprint; less elegant than layers/build artifact packaging.
- Outcome:
  - Lambda B runs with packaged dependency without Docker requirement.

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

- Decision: Add GitHub Actions workflow for `master` and PRs to run `npm ci`, `build`, and `synth`.
- Why:
  - Fast feedback before or alongside AWS deployment pipeline execution.
  - Catches type/synth regressions early.
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
