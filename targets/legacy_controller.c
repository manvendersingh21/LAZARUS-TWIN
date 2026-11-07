/* Demo target artifact. It represents an independently supplied legacy controller. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
typedef struct { double pwm; int estop; int cooling; } output_t;
output_t controller_step(double target, double angle, double velocity, double temp) {
    output_t out = {0.0, 0, 0};
    if (!isfinite(target) || !isfinite(angle) || !isfinite(velocity) || !isfinite(temp)) {
        out.estop = 1; out.cooling = 1; return out;
    }
    double error = target - angle;
    out.cooling = temp >= 72.0;
    if (temp >= 88.0 || fabs(error) > 45.0) { out.estop = 1; return out; }
    out.pwm = fmax(-100.0, fmin(100.0, 3.0 * error - 0.8 * velocity));
    return out;
}
int main(int argc, char **argv) {
    if (argc != 5) { fprintf(stderr, "usage: controller target angle velocity temperature\n"); return 2; }
    output_t out = controller_step(strtod(argv[1], NULL), strtod(argv[2], NULL), strtod(argv[3], NULL), strtod(argv[4], NULL));
    printf("%.17g %d %d\n", out.pwm, out.estop, out.cooling);
    return 0;
}
