/*
==================================================
COMPARAÇÃO HOJE X MESMO DIA DA SEMANA PASSADA
==================================================
*/

function getDateKeyLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function getOrdersForDate(date) {

  const targetDate =
    getDateKeyLocal(date);

  return Object.values(orders)
    .filter(order => {

      if (!order || !order.created_at) {
        return false;
      }

      return (
        getDateKeyLocal(
          new Date(order.created_at)
        ) === targetDate
      );

    });

}


function getWeekComparison() {

  const now =
    new Date();

  /*
  ================================================
  HOJE
  ================================================
  */

  const todayOrders =
    getOrdersForDate(now);


  /*
  ================================================
  MESMO DIA DA SEMANA PASSADA
  ================================================
  */

  const lastWeek =
    new Date(now);

  lastWeek.setDate(
    lastWeek.getDate() - 7
  );


  const lastWeekOrders =
    getOrdersForDate(lastWeek);


  /*
  ================================================
  HORÁRIO ATUAL
  ================================================
  */

  const currentHour =
    now.getHours();

  const currentMinute =
    now.getMinutes();


  /*
  ================================================
  CONTAGEM ACUMULADA ATÉ O HORÁRIO ATUAL
  ================================================
  */

  function countUntil(
    pedidos,
    hour,
    minute
  ) {

    return pedidos.filter(order => {

      const date =
        new Date(
          order.created_at
        );

      const h =
        date.getHours();

      const m =
        date.getMinutes();


      return (
        h < hour ||
        (
          h === hour &&
          m <= minute
        )
      );

    }).length;

  }


  const todayAccumulated =
    countUntil(
      todayOrders,
      currentHour,
      currentMinute
    );


  const lastWeekAccumulated =
    countUntil(
      lastWeekOrders,
      currentHour,
      currentMinute
    );


  let difference =
    todayAccumulated -
    lastWeekAccumulated;


  let percentage = 0;


  if (
    lastWeekAccumulated > 0
  ) {

    percentage =
      Number(
        (
          (
            difference /
            lastWeekAccumulated
          ) * 100
        ).toFixed(1)
      );

  }


  /*
  ================================================
  PEDIDOS POR HORA
  ================================================
  */

  const hourly = [];


  for (
    let hour = 0;
    hour <= currentHour;
    hour++
  ) {

    const todayCount =
      todayOrders.filter(order => {

        const date =
          new Date(
            order.created_at
          );

        return (
          date.getHours() === hour
        );

      }).length;


    const lastWeekCount =
      lastWeekOrders.filter(order => {

        const date =
          new Date(
            order.created_at
          );

        return (
          date.getHours() === hour
        );

      }).length;


    /*
    ==============================================
    ACUMULADO ATÉ CADA HORA
    ==============================================
    */

    const todayAccumulatedHour =
      todayOrders.filter(order => {

        const date =
          new Date(
            order.created_at
          );

        return (
          date.getHours() <= hour
        );

      }).length;


    const lastWeekAccumulatedHour =
      lastWeekOrders.filter(order => {

        const date =
          new Date(
            order.created_at
          );

        return (
          date.getHours() <= hour
        );

      }).length;


    hourly.push({

      hour,

      today:
        todayCount,

      last_week:
        lastWeekCount,

      today_accumulated:
        todayAccumulatedHour,

      last_week_accumulated:
        lastWeekAccumulatedHour

    });

  }


  return {

    today: {
      date:
        getDateKeyLocal(now),

      accumulated:
        todayAccumulated
    },

    last_week: {
      date:
        getDateKeyLocal(lastWeek),

      accumulated:
        lastWeekAccumulated
    },

    difference,

    percentage,

    current_hour:
      currentHour,

    current_minute:
      currentMinute,

    hourly

  };

}
