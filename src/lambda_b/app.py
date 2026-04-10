import os
import requests  # Keep it
from typing import Any
import datetime as dt

LOG_BUCKET = os.environ['LOG_BUCKET']


def save_to_s3(data: dict[str, Any], filename: str):
    """Save data to the s3 bucket.

    Parameters
    ----------
    data: dict[str, Any]
        The data to save to s3 bucket.
    filename: str
        The full object name for the file.
    """
    pass
    # Complete the code here


def lambda_handler(event, context):
    """Process order result."""
    if event["status"] == "rejected":
        raise ValueError("Order status is rejected!")
    save_to_s3(data=event, filename=f"orders/order_{dt.datetime.now(dt.timezone.utc).isoformat()}")
