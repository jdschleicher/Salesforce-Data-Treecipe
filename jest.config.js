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
        "out/*",
        ".*MockObjectsService\\.test\\.ts$"
    ],
    /*
        restoreMocks covers jest.spyOn and nothing else, and a NODE CORE module is shared by every
        suite in a worker rather than rebuilt with the module registry -- so a function written onto
        fs by assignment outlives the file that wrote it and jest has no record with which to undo
        it. setupCoreModuleIsolation puts those back. See jestSetup/CoreModuleIsolation.ts for the
        CI heap failure that behaviour produced.
    */
    setupFilesAfterEnv: ['jest-extended/all', '<rootDir>/jestSetup/setupCoreModuleIsolation.ts']

};
