function benchmarkAuth(req, res, next) {
  const expectedPassword = process.env.BENCHMARK_PASSWORD;
  if (!expectedPassword) {
    return res.status(500).json({
      success: false,
      error: 'Benchmark password is not configured.',
    });
  }

  const provided =
    req.headers['x-benchmark-password'] ||
    req.headers['x-company-password'] ||
    req.query?.password;

  if (!provided || provided !== expectedPassword) {
    return res.status(401).json({
      success: false,
      error: 'Invalid benchmark password.',
    });
  }

  return next();
}

module.exports = {
  benchmarkAuth,
};
