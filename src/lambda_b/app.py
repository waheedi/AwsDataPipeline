import os
import requests
import json
import boto3
from typing import Any
import datetime as dt

LOG_BUCKET = os.environ['LOG_BUCKET']
s3_client = boto3.client('s3')


def save_to_s3(data: dict[str, Any], filename: str):
    """Save data to the s3 bucket.

    Parameters
    ----------
    data: dict[str, Any]
        The data to save to s3 bucket.
    filename: str
        The full object name for the file.
    """
    s3_client.put_object(
        Bucket=LOG_BUCKET,
        Key=f"{filename}.json",
        Body=json.dumps(data).encode("utf-8"),
        ContentType="application/json",
    )


def lambda_handler(event, context):
    """Process order result."""
    if event["status"] == "rejected":
        raise ValueError("Order status is rejected!")
    save_to_s3(data=event, filename=f"orders/order_{dt.datetime.now(dt.timezone.utc).isoformat()}")
