import { exec } from 'child_process';

import { SnowfakeryIntegrationService } from '../SnowfakeryIntegrationService';


jest.mock('child_process');

describe('SnowfakeryService', () => {
    let snowfakeryIntegrationService: SnowfakeryIntegrationService;

    beforeEach(() => {
        snowfakeryIntegrationService = new SnowfakeryIntegrationService();
        jest.clearAllMocks();
    });

    describe('isSnowfakeryInstalled', () => {
        // test('returns true when snowfakery is installed', async () => {
        //     (exec as jest.Mock).mockImplementation((command, callback) => {
        //         callback(null, { stdout: 'snowfakery 3.1.0' });
        //     });

        //     const result = await snowfakeryIntegrationService.isSnowfakeryInstalled();
            
        //     expect(result).toBe(true);
        //     expect(exec).toHaveBeenCalledWith('snowfakery --version', expect.any(Function));
        // });

        // test('returns false when snowfakery is not installed', async () => {
        //     (exec as jest.Mock).mockImplementation((command, callback) => {
        //         callback(new Error('command not found: snowfakery'), null);
        //     });

        //     const result = await snowfakeryIntegrationService.isSnowfakeryInstalled();
            
        //     expect(result).toBe(false);
        //     expect(exec).toHaveBeenCalledWith('snowfakery --version', expect.any(Function));
        // });

    });

    describe('buildFieldInfoByXMLContent', () => {});
});