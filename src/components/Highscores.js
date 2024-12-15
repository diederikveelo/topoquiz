import React, { useEffect, useState } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

function Highscores() {
    const [scores, setScores] = useState([]);

    useEffect(() => {
        const fetchScores = async () => {
            const highScoresRef = collection(db, 'highscores');
            const q = query(
                highScoresRef,
                orderBy('score', 'desc'),
                orderBy('timeElapsed', 'asc'),
                limit(10)
            );

            const querySnapshot = await getDocs(q);
            const scoreData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setScores(scoreData);
        };

        fetchScores();
    }, []);

    const getGameModeName = (mode) => {
        switch(mode) {
            case 'click-country':
                return 'Vind het land';
            case 'guess-country':
                return 'Raad het land';
            case 'click-capital':
                return 'Vind het land bij hoofdstad';
            case 'guess-capital':
                return 'Raad de hoofdstad';
            default:
                return mode;
        }
    };

    return (
        <div className="highscores">
            <h3>Highscores</h3>
            <div className="scores-list">
                {scores.map((score, index) => (
                    <div key={score.id} className="score-item">
                        <span>{index + 1}.</span>
                        <span><b>{score.playerName}</b></span>
                        <span>{score.score}% ({Math.round(score.timeElapsed/1000)}s)</span>
                        <span>{getGameModeName(score.gameMode)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Highscores;