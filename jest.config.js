module.exports = {
    restoreMocks: true,
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    testPathIgnorePatterns: [
        "force-app/main/default/*",
        "force-app/test/*",
        "/mocks/",
    ]
};