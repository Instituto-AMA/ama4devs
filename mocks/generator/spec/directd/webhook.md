# The webhook contract of the provider

The provider publishes an OpenAPI file. This page keeps the parts of it the mock follows, byte for byte
(Portuguese included), so the mock can be checked against the source. Read on 2026-11-04.

Source: <https://api.app.directd.com.br/swagger/v1/swagger.json>

## The security scheme

```json
{
  "Token": {
    "type": "apiKey",
    "description": "Autenticação de APIs dos produtos da <b>App - Direct Data.</b> <br> Insira o seu <b>Token</b> da plataforma. <br><br>",
    "name": "Token",
    "in": "header"
  }
}
```

## The paths

```json
{
  "/api/Webhook/CreateUrlCallBack": {
    "post": {
      "tags": [
        "WEBHOOK"
      ],
      "summary": "Creates a callback URL. The system will send a POST to this endpoint with a JSON payload.",
      "description": "Example payload:\r\n\r\n{\r\n\r\n    \"Url\": \"https://example.com.br/YourPostCallBack\"\r\n    \r\n}\r\n\r\n\r\nExample of sending to your callback url:\r\n\r\n{\r\n\r\n    \"MessageStep\": \"Send this code to 'POST Webhook/ConfirmUrlCallBack'\",\r\n    \r\n    \"Code\": \"CALL-A123\",\r\n    \r\n    \"Status\": \"Created\"\r\n    \r\n}\r\n\r\nThe endpoint should return HTTP 201 CREATED. The response body is optional.",
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackUrl"
            }
          },
          "text/json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackUrl"
            }
          },
          "application/*+json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackUrl"
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "OK"
        },
        "201": {
          "description": "Created."
        },
        "400": {
          "description": "Bad Request. - The request body is invalid or malformed."
        },
        "401": {
          "description": "Unauthorized. - The client did not provide the correct credentials."
        },
        "500": {
          "description": "Internal Server Error. - An unexpected error occurred on the server."
        }
      }
    }
  },
  "/api/Webhook/ConfirmUrlCallBack": {
    "post": {
      "tags": [
        "WEBHOOK"
      ],
      "summary": "Method to Confirm Url CallBack. Send a post to this endpoint using this example payload.",
      "description": "Example payload:\r\n\r\n{\r\n\r\n    \"Code\": \"Call-A123\"\r\n    \r\n}\r\n\r\nExemple Response:\r\n            \r\n{\r\n\r\n    \"id\": \"ed0611a7-d942-44d6-b4be-c45d6d70cd26\",\r\n    \r\n    \"result\": \"Confirmed\",\r\n    \r\n    \"status\": \"OK\",\r\n    \r\n    \"elapsedTimeMs\": 4,\r\n    \r\n    \"dateTimeExecution\": \"7/14/2025 3:46:14 PM\"\r\n    \r\n}\r\n\r\nThe endpoint should return HTTP 200 OK. The response body is optional.\r\n\r\n\r\n\r\n\r\nCallBack:\r\n\r\nThis is an example of how future requests will arrive at your callback endpoint.\r\n\r\nExample:\r\n            \r\n{\r\n\r\n    \"Product\": \"Enrichment\",\r\n    \r\n    \"Id\": \"00-X123\",\r\n    \r\n    \"Status\": \"Created\"\r\n    \r\n    \"Url\": \"https://app.example.com.br/api/Enrichment?ID=00-X123\"\r\n    \r\n}\r\n\r\nRecommendations: Save received files to your database or to a log file to facilitate integration.\r\n\r\nProduct:\r\n\r\n- Enrichment: \"Enrichment\"\r\n- AdvancedSearch: \"AdvancedSearch\"\r\n- LookALike: \"LookALike\"\r\n- Dossier: \"Dossier\"\r\n- CorporateLinkage: \"CorporateLinkage\"\r\n- APIv3: \"APIv3\", \"APIv3-StatusAvailability\"\r\n\r\nStatus:\r\n\r\n- Created\r\n- Processing\r\n- Error\r\n- Canceled \r\n- Modified\r\n- Finished",
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackCode"
            }
          },
          "text/json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackCode"
            }
          },
          "application/*+json": {
            "schema": {
              "$ref": "#/components/schemas/DirectDataV3.Library.DTO.Callback.CallbackCode"
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "Success."
        },
        "401": {
          "description": "Unauthorized. - The client did not provide the correct credentials to access the resource."
        },
        "500": {
          "description": "Error performing action. - The server was unable to process the request successfully. Please contact our support team."
        }
      }
    }
  },
  "/api/Marketplace/GetBalance": {
    "get": {
      "tags": [
        "MARKETPLACE"
      ],
      "summary": "Method for retrieving the company balance.",
      "responses": {
        "200": {
          "description": "OK"
        }
      }
    }
  },
  "/api/Billing/GetConsumptionApiV3": {
    "get": {
      "tags": [
        "BILLING"
      ],
      "summary": "Method to get API consumption.",
      "responses": {
        "200": {
          "description": "Success."
        },
        "401": {
          "description": "Unauthorized. - The client did not provide the correct credentials."
        },
        "429": {
          "description": "Too Many Requests. - Rate limit exceeded. Check the Retry-After header (when present) for wait time in seconds."
        },
        "500": {
          "description": "Internal Server Error. - An unexpected error occurred on the server."
        }
      }
    }
  }
}
```

The answers of the two account routes (`GetBalance` and `GetConsumptionApiV3`) are not in the OpenAPI file: the
real answers were captured on 2026-11-04 and live in `marketplace-get-balance.response.json` and
`billing-get-consumption-api-v3.response.json`.
