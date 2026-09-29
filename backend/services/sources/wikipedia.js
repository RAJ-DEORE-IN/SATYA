module.exports = {
    name: "Wikipedia Current Events",
    fetchContext: async () => {
        return [
            {
                topic: "India Space Exploration",
                context: "ISRO's SSLV series represents small-satellite launch infrastructure under NewSpace India Limited (NSIL).",
                sourceType: "wikipedia",
                verifiedStatus: "REFERENCE ONLY"
            }
        ];
    }
};