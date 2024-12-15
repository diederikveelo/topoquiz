import React, { useState } from 'react';

function HighscoreModal({ score, timeElapsed, onSubmit, onClose }) {
    const [playerName, setPlayerName] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (playerName.trim()) {
            onSubmit(playerName.trim());
        }
    };

    return (
        <div className="highscore-modal-overlay">
            <div className="highscore-modal">
                <h2>Nieuwe Highscore!</h2>
                <p>Je score: {score}%</p>
                <p>Tijd: {Math.round(timeElapsed/1000)} seconden</p>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="Jouw naam"
                        maxLength={20}
                        autoFocus
                    />
                    <div className="modal-buttons">
                        <button type="submit" disabled={!playerName.trim()}>
                            Opslaan
                        </button>
                        <button type="button" onClick={onClose}>
                            Annuleren
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default HighscoreModal;