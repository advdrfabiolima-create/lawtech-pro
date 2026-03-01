module.exports = {
    testEnvironment: 'node',
    collectCoverageFrom: [
        'src/services/chargeService.js',
        'src/middlewares/authMiddleware.js',
        'src/utils/validators.js',
        'src/utils/crypto.js'
    ],
    coverageThreshold: {
        global: { lines: 50 }
    },
    testMatch: ['**/__tests__/**/*.test.js']
};
