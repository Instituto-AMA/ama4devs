# Meta's Cloud API specification, per Graph version

Each folder is one Graph version the mock serves (`v23.0`). It holds:

- `business-messaging-api.yaml`: Meta's OpenAPI file for the WhatsApp Business
  Platform, as Meta publishes it in github.com/facebook/openapi (MIT license,
  Copyright (c) Meta Platforms, Inc. and affiliates). It is vendored unchanged.
- `errata.json`: where Meta's specification contradicts Meta's own examples or
  API, the correction the mock applies when it loads the file, and under
  `reasons` why each one was made (`src/graph/spec.ts` documents every key).

The mock routes, validates and answers every operation of the file; the
contract test (`src/graph/contract.test.ts`) sends every request example of
every version through the mock.

A new version is a new folder, copied from Meta's repository with its errata,
and an entry in `src/graph/versions.ts`.
