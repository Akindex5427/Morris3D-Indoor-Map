import React from "react";

const LoadingSpinner = ({ message = "Loading map data..." }) => {
  return (
    <div className="loading-container">
      <div className="loading-spinner">
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-building-icon">🏢</div>
      </div>
      <p className="loading-message">{message}</p>
      <style jsx>{`
        .loading-container {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .loading-spinner {
          position: relative;
          width: 120px;
          height: 120px;
          margin-bottom: 24px;
        }

        .spinner-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 4px solid transparent;
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1.5s cubic-bezier(0.5, 0, 0.5, 1) infinite;
        }

        .spinner-ring:nth-child(1) {
          animation-delay: -0.45s;
          opacity: 0.9;
        }

        .spinner-ring:nth-child(2) {
          animation-delay: -0.3s;
          opacity: 0.6;
          width: 85%;
          height: 85%;
          top: 7.5%;
          left: 7.5%;
        }

        .spinner-ring:nth-child(3) {
          animation-delay: -0.15s;
          opacity: 0.3;
          width: 70%;
          height: 70%;
          top: 15%;
          left: 15%;
        }

        .spinner-building-icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 36px;
          animation: pulse 2s ease-in-out infinite;
        }

        .loading-message {
          font-size: 1.1rem;
          font-weight: 500;
          letter-spacing: 0.5px;
          animation: fadeInOut 2s ease-in-out infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            transform: translate(-50%, -50%) scale(1.1);
          }
        }

        @keyframes fadeInOut {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
};

export default LoadingSpinner;
