import { exec } from 'child_process';

import { SnowfakeryIntegrationService } from '../SnowfakeryIntegrationService';

jest.mock('vscode', () => ({
  window: {
    showInformationMessage: jest.fn()
  },
  ThemeIcon: jest.fn().mockImplementation(
      (name) => ({ id: name })
  ),
  FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
  }

}), { virtual: true });

jest.mock('child_process', () => ({
    exec: jest.fn()
}));



describe('Shared SnowfakeryIntegrationService tests', () => {

    // let snowfakeryIntegrationService: SnowfakeryIntegrationService;

    // beforeEach(() => {
    //     snowfakeryIntegrationService = new SnowfakeryIntegrationService();
    //     jest.clearAllMocks();
    // });

    describe('isSnowfakeryInstalled', () => {


        test('should return true when Snowfakery is installed', async () => {
            const mockedExec = jest.mocked(exec);

            const mockStdout = 'snowfakery version 4.0.0';
            mockedExec.mockImplementation((command, callback: any) => {
                callback(null, mockStdout);
                return {} as any;
            });
    
            const result = await SnowfakeryIntegrationService.isSnowfakeryInstalled();
            expect(result).toBe(true);
        });

        // test('returns true when snowfakery is installed', async () => {
        //     (exec as jest.Mock).mockImplementation((command, callback) => {
        //         callback(null, { stdout: 'snowfakery 3.1.0' });
        //     });

        //     jest.spyOn(exec, 'exec').mockImplementation(() => new SnowfakeryFakerService());
            
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

});