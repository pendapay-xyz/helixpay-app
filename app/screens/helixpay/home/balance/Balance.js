import React from 'react';
import RootNavigation from 'screens/RootNavigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BalanceContent from 'screens/helixpay/home/balance/content/BalanceContent';
import CBHelper from 'helpers/CBHelper';
import CBSyncHandler from 'handlers/CBSyncHandler';
import CBRunHandler from 'handlers/CBRunHandler';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-simple-toast';
import { strings } from 'controls/i18n';
import axios from 'axios';
import {privateKeyToAccount, publicKeyToAddress, english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import { bytesToHex, hexToBytes, keccak256 } from 'viem';
import {getPublicKey, getSharedSecret, ProjectivePoint, utils, CURVE} from '@noble/secp256k1';

const STEALTH_ADDRESS_SIGNATURE = "Stealth Signed Message:\n";

import Base from 'screens/Base';

export default class Balance extends Base {

    constructor(props) {
        super(props);
        this.state = {
            address: null,
            refreshing: false,
            balances: null,
            transactions: [],
        };
    }

    componentDidMount() {
        super.componentDidMount();
        this.load();
    }

    componentWillUnmount() {
        super.componentWillUnmount();
    }

    load() {
        CBHelper.reactionApplication();
        CBHelper.refreshApplication(() => {
            CBSyncHandler.sync();
            CBRunHandler.run();
        });
        this.setState({
            refreshing: true,
        }, async () => {
            // RootNavigation.navigate('Introduction');
            const address = await AsyncStorage.getItem('@address');
            const username = await AsyncStorage.getItem('@username');
            if (!!address) {
                this.setState({ address, username }, () => {
                    if (address) {
                        this.getBalance(address);
                        this.getTransactionData(address);
                    }
                });
            } else {
                RootNavigation.navigate('Introduction');
            }
        });
    };

    generateStealthMetaAddressFromKeys = (spendingPublicKey, viewingPublicKey) => {
        return `0x${spendingPublicKey.slice(2)}${viewingPublicKey.slice(2)}`;
    };

    generateStealthKeyFromSignature = (signature) => {
        const { portion1, portion2, lastByte } = this.extractPortions(signature);

        if (`0x${portion1}${portion2}${lastByte}` !== signature) {
            throw new Error("Signature incorrectly generated or parsed");
        }

        const spendingPrivateKey = hexToBytes(keccak256(`0x${portion1}`));
        const viewingPrivateKey = hexToBytes(keccak256(`0x${portion2}`));

        const spendingPublicKey = bytesToHex(getPublicKey(spendingPrivateKey, true));
        const viewingPublicKey = bytesToHex(getPublicKey(viewingPrivateKey, true));

        return {
            spendingKey: {
                publicKey: spendingPublicKey,
                privateKey: bytesToHex(spendingPrivateKey),
            },
            viewingKey: {
                publicKey: viewingPublicKey,
                privateKey: bytesToHex(viewingPrivateKey),
            },
        };
    };

    extractPortions = (signature) => {
        const startIndex = 2;
        const length = 64;

        const portion1 = signature.slice(startIndex, startIndex + length);
        const portion2 = signature.slice(
            startIndex + length,
            startIndex + length + length
        );
        const lastByte = signature.slice(signature.length - 2);

        return { portion1, portion2, lastByte };
    };

    parseKeysFromStealthMetaAddress = (stealthMeta) => {
        const spendingPublicKey = `0x${stealthMeta.slice(2, 68)}`;
        const viewingPublicKey = `0x${stealthMeta.slice(68)}`;

        return {
            spendingPublicKey,
            viewingPublicKey,
        };
    };

    getViewTag = (hashSharedSecret) => {
        return `0x${hashSharedSecret.toString().substring(2, 4)}`;
    };

    getStealthPublicKey = (spendingPublicKey, hashSharedSecret) => {
        const hashedSharedSecretPoint = ProjectivePoint.fromPrivateKey(
            hexToBytes(hashSharedSecret)
        );

        return bytesToHex(
            ProjectivePoint.fromHex(spendingPublicKey.slice(2))
                .add(hashedSharedSecretPoint)
                .toRawBytes(false)
        );
    };

    generateStealthAddress = (stealthMeta) => {
        const ephemeralPrivateKey = utils.randomPrivateKey();
        const ephemeralPublicKey = getPublicKey(ephemeralPrivateKey, true);
        const sharedSecret = getSharedSecret(
            ephemeralPrivateKey,
            ProjectivePoint.fromHex(stealthMeta.viewingPublicKey.slice(2)).toRawBytes(
                true
            )
        );

        const hashSharedSecret = keccak256(sharedSecret);
        const viewTag = this.getViewTag(hashSharedSecret);

        const newStealthPublicKey = this.getStealthPublicKey(
            stealthMeta.spendingPublicKey,
            hashSharedSecret
        );
        const newStealthAddress = publicKeyToAddress(newStealthPublicKey);

        return {
            stealthPublicKey: newStealthAddress,
            ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
            viewTag,
        };
    };

    addPriv = ({ a, b }) => {
        const curveOrderBigInt = BigInt(CURVE.n);
        return (a + b) % curveOrderBigInt;
    };

    computeStealthPrivateKey = (stealthKey, ephemeralPublicKey) => {
        const sharedSecret = getSharedSecret(
            hexToBytes(stealthKey.viewingKey.privateKey),
            hexToBytes(ephemeralPublicKey)
        );

        const hashSharedSecret = keccak256(sharedSecret);

        const spendingPrivateKeyBigInt = BigInt(stealthKey.spendingKey.privateKey);
        const hashedSecretBigInt = BigInt(hashSharedSecret);

        const stealthPrivateKeyBigInt = this.addPriv({
            a: spendingPrivateKeyBigInt,
            b: hashedSecretBigInt,
        });

        return `0x${stealthPrivateKeyBigInt.toString(16).padStart(64, "0")}`;
    };

    onCreateUser = async () => {
        const seedPhrase = await AsyncStorage.getItem('@seedPhrase');
        const account = mnemonicToAccount(seedPhrase);
        const signature = await account.signMessage({
            message: STEALTH_ADDRESS_SIGNATURE + account.address,
        });
        const stealthKey = this.generateStealthKeyFromSignature(signature);
        const stealthMeta = this.generateStealthMetaAddressFromKeys(
            stealthKey.spendingKey.publicKey,
            stealthKey.viewingKey.publicKey
        );
        console.log(`mienpv :: ${JSON.stringify(stealthMeta)}`);

    }

    onSend = () => {
        RootNavigation.navigate('Send');
    }

    onRefresh = () => {
        this.load();
    }

    onCopyAddress = () => {
        const { address } = this.state;
        Clipboard.setString(address);
        Toast.show(strings('text_copied_to_clipboard'), Toast.LONG);
    }

    async getEthToUsdPrice() {
        try {
            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            return response.data.ethereum.usd;
        } catch (error) {
            console.error('Error fetching Ether to USD price:', error);
            return 0;
        }
    }

    async getBalance(address) {
        const url = `https://scan-api-testnet.viction.xyz/api/account/${address}/tokenBalance?offset=0&limit=50`;
        try {
            const response = await axios.get(url);
            if (response.data) {
                const balances = response?.data;
                this.setState({ balances: balances, refreshing: false });
            } else {
                console.log('Error fetching balance from Viction:2', response.data.message || 'No data available');
                this.setState({ refreshing: false });
            }
        } catch (error) {
            console.error('Error fetching balance from Viction1:', error);
            this.setState({ refreshing: false });
        }
    }

    async getTransactionData(address) {
        const url = `https://scan-api-testnet.viction.xyz/api/transaction/list?account=${address}&offset=0&limit=20`;

        try {
            const response = await axios.get(url);

            if (response.data && response.data.data) {
                this.setState({ transactions: response.data.data, refreshing: false});
            } else {
                console.error('No transaction data available');
                this.setState({ refreshing: false });
            }
        } catch (error) {
            console.error('Error fetching transaction data:', error);
            this.setState({ refreshing: false });
        }
    }

    render() {
        const {refreshing, address, username, balances, transactions} = this.state;
        return (
            <BalanceContent defaultParam={this.defaultParam} refreshing={refreshing} username={username} address={address} balances={balances} transactions={transactions} onCreateUser={this.onCreateUser} onRefresh={this.onRefresh} onCopyAddress={this.onCopyAddress} onSend={this.onSend}/>
        );
    }
}
