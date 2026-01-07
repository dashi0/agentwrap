#!/usr/bin/env python3
"""
Simple echo script for demonstration.
Returns the input with additional metadata.
"""

import json
import sys
from datetime import datetime


def echo_message(message: str) -> dict:
    """
    Echo back a message with metadata.

    Args:
        message: Message to echo

    Returns:
        dict with echoed message and metadata
    """
    return {
        "status": "success",
        "echo": message,
        "timestamp": datetime.now().isoformat(),
        "test_marker": "ECHO_EXECUTED",
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: echo.py <message>"}))
        sys.exit(1)

    message = " ".join(sys.argv[1:])
    result = echo_message(message)
    print(json.dumps(result, indent=2))
