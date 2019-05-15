/* Copyright (c) 2015 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Use in source and binary forms, redistribution in binary form only, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions in binary form, except as embedded into a Nordic
 *    Semiconductor ASA integrated circuit in a product or a software update for
 *    such product, must reproduce the above copyright notice, this list of
 *    conditions and the following disclaimer in the documentation and/or other
 *    materials provided with the distribution.
 *
 * 2. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * 3. This software, with or without modification, must only be used with a Nordic
 *    Semiconductor ASA integrated circuit.
 *
 * 4. Any software provided in binary form under this license must not be reverse
 *    engineered, decompiled, modified and/or disassembled.
 *
 * THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { logger } from 'nrfconnect/core';
import { DTM_PHY_STRING, DTM_MODULATION_STRING, DTM } from 'nrf-dtm-js/src/DTM.js';
import * as SettingsActions from '../actions/settingsActions';
import * as Constants from '../utils/constants';

export const DTM_TEST_STARTED_ACTION = 'DTM_TEST_STARTED_ACTION';
export const DTM_TEST_STOPPED_ACTION = 'DTM_TEST_STOPPED_ACTION';
export const DTM_TEST_ENDED_SUCCESSFULLY_ACTION = 'DTM_TEST_ENDED_SUCCESSFULLY_ACTION';
export const DTM_TEST_ENDED_FAILURE_ACTION = 'DTM_TEST_ENDED_FAILURE_ACTION';
export const DTM_BOARD_SELECTED_ACTION = 'DTM_BOARD_SELECTED_ACTION';
export const DTM_CHANNEL_START = 'DTM_CHANNEL_START';
export const DTM_CHANNEL_END = 'DTM_CHANNEL_END';
export const DTM_CHANNEL_RESET = 'DTM_CHANNEL_RESET';
export const DTM_TEST_DONE = 'DTM_TEST_DONE';

export const TEST_STATES = {
    idle: 0,
    running: 1,
    stopping: 2,
};

const dtmStatisticsUpdated = dispatch => (event => {
    if (event.type === 'reset') {
        dispatch({
            type: DTM_CHANNEL_RESET,
        });
    } else if (event.action === 'started') {
        dispatch({
            type: DTM_CHANNEL_START,
            channel: event.channel,
        });
    } else if (event.action === 'ended') {
        dispatch({
            type: DTM_CHANNEL_END,
            channel: event.channel,
            received: event.packets,
        });
    } else if (event.action === 'done') {
        dispatch({
            type: DTM_TEST_DONE,
        });
    }
});

let dtm;
export function selectDevice(comName, board) {
    dtm = new DTM(comName);
    return dispatch => {
        dtm.on('update', dtmStatisticsUpdated(dispatch));
        dispatch({
            type: DTM_BOARD_SELECTED_ACTION,
            board,
        });
    };
}

async function setupDevice(settings) {
    const setupResult = res => typeof res === 'object' && res.length >= 2 && res[0] === 0 && res[1] === 0;
    let res = await dtm.setupReset();
    if (!setupResult(res)) {
        logger.info('DTM setup reset command failed.');
    }
    const { txPower, length, modulationMode, phy } = settings;

    res = await dtm.setTxPower(Constants.dbmValues[txPower]);
    if (!setupResult(res)) {
        logger.info(`DTM setup tx power command failed with ${Constants.dbmValues[txPower]} dbm.`);
    }

    res = await dtm.setupLength(length);
    if (!setupResult(res)) {
        logger.info(`DTM setup length command failed with length ${length}.`);
    }

    res = await dtm.setupModulation(modulationMode);
    if (!setupResult(res)) {
        logger.info(`DTM setup modulation command failed with parameter ${DTM_MODULATION_STRING[modulationMode]}.`);
    }

    res = await dtm.setupPhy(phy);
    if (!setupResult(res)) {
        logger.info(`DTM setup physical command failed with parameter ${DTM_PHY_STRING[phy]}.`);
    }
}

export function startTests() {
    return async (dispatch, getState) => {
        const { settings } = getState().app;
        const { bitpattern, length, singleChannel, lowChannel, highChannel,
                sweepTime, timeout, testMode, channelMode } = settings;

        const { DTM_TEST_MODE_BUTTON, DTM_CHANNEL_MODE } = SettingsActions;
        const { transmitter, receiver } = DTM_TEST_MODE_BUTTON;
        const { single, sweep } = DTM_CHANNEL_MODE;

        logger.info('Running device setup.');
        await setupDevice(settings);
        logger.info('Starting test.');

        let testPromise;
        if (testMode === transmitter && channelMode === single) {
            testPromise = dtm.singleChannelTransmitterTest(
                bitpattern,
                length,
                singleChannel,
                timeout,
            );
        } else if (testMode === transmitter && channelMode === sweep) {
            testPromise = dtm.sweepTransmitterTest(
                bitpattern,
                length,
                lowChannel,
                highChannel,
                sweepTime,
                timeout,
            );
        } else if (testMode === receiver && channelMode === single) {
            testPromise = dtm.singleChannelReceiverTest(
                singleChannel,
                timeout,
            );
        } else {
            testPromise = dtm.sweepReceiverTest(
                lowChannel,
                highChannel,
                sweepTime,
                timeout,
            );
        }

        testPromise
            .then(status => {
                const { success, channel, received, receivedPerChannel, message } = status;
                if (success) {
                    let receivedChannels = receivedPerChannel;
                    if (receivedChannels === undefined) {
                        receivedChannels = new Array(40).fill(0);
                    }
                    if (channel !== undefined && received !== undefined) {
                        receivedChannels[channel] = received;
                    }
                    const testTypeStr = testMode === transmitter ?
                        'Transmitter' : 'Receiver';
                    const packetsRcvStr = testMode === transmitter ?
                        '' : ` Received ${received} packets.`;
                    logger.info(`${testTypeStr} test finished successfully.${packetsRcvStr}`);
                    dispatch({
                        type: DTM_TEST_ENDED_SUCCESSFULLY_ACTION,
                        received: receivedChannels,
                    });
                } else {
                    dispatch({
                        type: DTM_TEST_ENDED_FAILURE_ACTION,
                        message,
                    });
                }
            });

        dispatch({
            type: DTM_TEST_STARTED_ACTION,
        });
    };
}

export function endTests() {
    logger.info('Ending test.');
    return dispatch => {
        dtm.endTest()
            .then(res => {
                if (res !== undefined) {
                    dispatch({
                        type: DTM_TEST_STOPPED_ACTION,
                    });
                }
            });
    };
}