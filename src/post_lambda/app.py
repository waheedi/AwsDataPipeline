import logging
import json
import os
from typing import Any

logger = logging.getLogger()

TABLE_NAME = os.environ['TABLE_NAME']


def save_to_db(records: list[dict[str, Any]]):
    """Save records to the table.

    Parameters
    ----------
    records: list[dict[str, Any]]
        The data to save to Table.
    """
    # saving records to the Table, Complete the code in here
    logger.info("Records are successfully saved to the DB table %s.", TABLE_NAME)


def lambda_handler(event, context):
    """Process POST request to the API."""
    logger.info(
        'Received %s request to %s endpoint',
        event["httpMethod"],
        event["path"])

    if (orders := event['body']) is not None:
        logger.info("Orders received: %s.", orders)
        save_to_db(records=orders)

        return {
            "isBase64Encoded": False,
            "statusCode": 201,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": ""
        }

    return {
        "isBase64Encoded": False,
        "statusCode": 400,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps({"errorMessage": "Request body is empty"})
    }
