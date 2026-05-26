export function calculateRecommendation(ourPrice, rates = [], settings = {}) {
  const prices = rates
    .map(rate => Number(rate.price ?? rate.amount ?? rate.tarif ?? 0))
    .filter(price => !Number.isNaN(price) && price > 0)

  if (!prices.length) {
    return {
      recommendedPrice: null,
      averageCompetitorPrice: null,
      minCompetitorPrice: null,
      maxCompetitorPrice: null,
      competitorCount: 0,
      message: 'Aucun tarif concurrent disponible'
    }
  }

  const sortedPrices = [...prices].sort((a, b) => a - b)

  const minCompetitorPrice = sortedPrices[0]
  const maxCompetitorPrice = sortedPrices[sortedPrices.length - 1]

  const averageCompetitorPrice =
    prices.reduce((sum, price) => sum + price, 0) / prices.length

  const medianCompetitorPrice =
    sortedPrices.length % 2 === 1
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : (
          sortedPrices[sortedPrices.length / 2 - 1] +
          sortedPrices[sortedPrices.length / 2]
        ) / 2

  const thresholdLow = settings.thresholdLow ?? 15
  const thresholdHigh = settings.thresholdHigh ?? 20

  const ourPriceNumber = Number(ourPrice || 0)

  let recommendedPrice = medianCompetitorPrice

  if (ourPriceNumber > 0) {
    const gapPercent =
      ((averageCompetitorPrice - ourPriceNumber) / ourPriceNumber) * 100

    if (gapPercent > thresholdHigh) {
      recommendedPrice = Math.round(averageCompetitorPrice * 0.95)
    } else if (gapPercent > thresholdLow) {
      recommendedPrice = Math.round(averageCompetitorPrice * 0.97)
    } else {
      recommendedPrice = Math.round(medianCompetitorPrice)
    }
  } else {
    recommendedPrice = Math.round(medianCompetitorPrice)
  }

  return {
    recommendedPrice,
    averageCompetitorPrice: Math.round(averageCompetitorPrice),
    medianCompetitorPrice: Math.round(medianCompetitorPrice),
    minCompetitorPrice,
    maxCompetitorPrice,
    competitorCount: prices.length,
    ourPrice: ourPriceNumber
  }
}
