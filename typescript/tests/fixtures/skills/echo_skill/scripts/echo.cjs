#!/usr/bin/env node
/**
 * Simple echo script for demonstration.
 * Returns the input with additional metadata.
 */

function echoMessage(message) {
  /**
   * Echo back a message with metadata.
   *
   * @param {string} message - Message to echo
   * @returns {Object} Object with echoed message and metadata
   */
  return {
    status: 'success',
    echo: message,
    timestamp: new Date().toISOString(),
    test_marker: 'ECHO_EXECUTED',
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(JSON.stringify({ error: 'Usage: echo.js <message>' }));
    process.exit(1);
  }

  const message = args.join(' ');
  const result = echoMessage(message);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { echoMessage };
